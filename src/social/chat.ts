/*
 * Project chat (stage D): messages, comments on the text, and "who changed what",
 * all in one feed per shared project. Everything is encrypted with the project key;
 * the server only sees who posted when. New messages arrive through the project's
 * realtime channel, with a regular check as a fallback.
 */
import { useSyncExternalStore } from 'react';
import { currentUserId, getSyncStatus, onProjectEvent, sendProjectEvent, sharedKey, sharedRole, supabaseClient as sb } from '../sync/engine';
import { decryptJSON, encryptJSON } from '../sync/crypto';
import { isMuted } from './mute';
import { getSocial } from './api';

export type MsgKind = 'msg' | 'comment' | 'activity';
export interface ItemRef { t: string; id: string; label: string }
export interface Body {
  text?: string;
  // comments
  sceneId?: string; scene?: string; quote?: string; before?: string;
  // activity
  type?: 'edit' | 'items';
  added?: number; removed?: number;
  items?: { added: ItemRef[]; removed: ItemRef[] };
}
export interface Msg {
  id: string; project_id: string; author: string; kind: MsgKind; reply_to: string | null;
  resolved: boolean; deleted: boolean; created_at: string; edited_at: string | null; seq: number;
  body: Body | null;
  pending?: boolean; failed?: boolean;
}
interface PState { msgs: Msg[]; byId: Map<string, Msg>; maxSeq: number; loaded: boolean; error?: string; busy?: Promise<void>; again?: boolean }
export interface ChatSnapshot { msgs: Msg[]; byId: Map<string, Msg>; loaded: boolean; error?: string }

const store = new Map<string, PState>();
const snaps = new Map<string, ChatSnapshot>();
const ls = new Set<() => void>();
const EMPTY: ChatSnapshot = { msgs: [], byId: new Map(), loaded: false };
const st = (pid: string) => { let s = store.get(pid); if (!s) { s = { msgs: [], byId: new Map(), maxSeq: 0, loaded: false }; store.set(pid, s); } return s; };
function emit(pid: string) {
  const s = st(pid);
  snaps.set(pid, { msgs: s.msgs, byId: s.byId, loaded: s.loaded, error: s.error });
  ls.forEach((l) => l());
}
export const useChat = (pid: string) => useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => snaps.get(pid) ?? EMPTY, () => snaps.get(pid) ?? EMPTY);
export const getChat = (pid: string) => snaps.get(pid) ?? EMPTY;

const COLS = 'id,project_id,author,kind,reply_to,data,resolved,deleted,created_at,edited_at,seq';
const friendly = (e: { message?: string; code?: string } | null) => {
  if (!e) return null;
  const m = e.message ?? '';
  if (/writell_messages|schema cache|PGRST20/.test(m)) return new Error('Chat isn’t set up in Supabase yet: run the stage D setup script.');
  if (/row-level security/.test(m)) { const p = getSocial().me; const until = (d?: string | null) => !!d && Date.parse(d) > Date.now(); return new Error(until(p?.banned_until) ? 'You’re banned from chatting right now.' : until(p?.chat_muted_until) ? 'You’re muted in chats right now.' : 'You’re not allowed to do that here.'); }
  if (/fetch|network/i.test(m)) return new Error('Can’t reach the server. Check your internet connection.');
  return new Error(m.replace(/^.*?exception: /, '') || 'Something went wrong.');
};
const byTime = (a: Msg, b: Msg) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

/* ---------------- new-message notifications ---------------- */
const newListeners = new Set<(pid: string, msgs: Msg[]) => void>();
export function onNewMessages(f: (pid: string, msgs: Msg[]) => void) { newListeners.add(f); return () => { newListeners.delete(f); }; }

/* ---------------- loading ---------------- */
type RawRow = Omit<Msg, 'body'> & { data: string | null };
async function absorb(pid: string, rows: RawRow[], notify: boolean) {
  const key = sharedKey(pid); if (!key) return;
  const s = st(pid); const fresh: Msg[] = [];
  for (const r of rows) {
    let body: Body | null = null;
    if (r.data && !r.deleted) { try { body = await decryptJSON<Body>(key, r.data); } catch { body = { text: '(this message couldn’t be unlocked)' }; } }
    const m: Msg = { id: r.id, project_id: r.project_id, author: r.author, kind: r.kind, reply_to: r.reply_to, resolved: r.resolved, deleted: r.deleted, created_at: r.created_at, edited_at: r.edited_at, seq: Number(r.seq), body };
    if (!s.byId.has(m.id) && !m.deleted && m.author !== currentUserId()) fresh.push(m);
    s.byId.set(m.id, m);
    s.maxSeq = Math.max(s.maxSeq, m.seq);
  }
  s.msgs = [...s.byId.values()].filter((m) => !m.deleted).sort(byTime);
  s.byId = new Map(s.byId);
  emit(pid);
  if (notify && fresh.length) newListeners.forEach((f) => f(pid, fresh));
}

export function refreshChat(pid: string): Promise<void> {
  const s = st(pid);
  if (!sharedKey(pid) || !currentUserId()) return Promise.resolve();
  if (s.busy) { s.again = true; return s.busy; }
  s.busy = (async () => {
    try {
      if (!s.loaded) {
        const { data, error } = await sb().from('writell_messages').select(COLS).eq('project_id', pid).order('seq', { ascending: false }).limit(400);
        if (error) throw friendly(error);
        await absorb(pid, ((data ?? []) as RawRow[]).reverse(), false);
        s.loaded = true; s.error = undefined; emit(pid);
      } else {
        for (let i = 0; i < 10; i++) {
          const { data, error } = await sb().from('writell_messages').select(COLS).eq('project_id', pid).gt('seq', s.maxSeq).order('seq', { ascending: true }).limit(500);
          if (error) throw friendly(error);
          const rows = (data ?? []) as RawRow[];
          if (rows.length) await absorb(pid, rows, true);
          if (rows.length < 500) break;
        }
        if (s.error) { s.error = undefined; emit(pid); }
      }
    } catch (e) { s.error = (e as Error).message; emit(pid); }
  })().finally(() => { s.busy = undefined; if (s.again) { s.again = false; void refreshChat(pid); } });
  return s.busy;
}

/* ---------------- sending ---------------- */
function me() { const id = currentUserId(); if (!id) throw new Error('Sign in first (Settings → Account & sync).'); return id; }
function keyFor(pid: string) { const k = sharedKey(pid); if (!k) throw new Error('This project isn’t shared.'); return k; }

export async function post(pid: string, kind: MsgKind, body: Body, replyTo?: string | null): Promise<string> {
  const author = me(); const key = keyFor(pid);
  const id = crypto.randomUUID();
  const s = st(pid);
  const local: Msg = { id, project_id: pid, author, kind, reply_to: replyTo ?? null, resolved: false, deleted: false, created_at: new Date().toISOString(), edited_at: null, seq: 0, body, pending: true };
  s.byId.set(id, local); s.msgs = [...s.msgs, local]; s.byId = new Map(s.byId); emit(pid);
  const { error } = await sb().from('writell_messages').insert({ id, project_id: pid, author, kind, reply_to: replyTo ?? null, data: await encryptJSON(key, body) });
  if (error) {
    s.byId.delete(id); s.msgs = s.msgs.filter((m) => m.id !== id); s.byId = new Map(s.byId); emit(pid);
    throw friendly(error);
  }
  sendProjectEvent(pid, 'chat');
  await refreshChat(pid);
  return id;
}
async function patch(pid: string, id: string, change: Record<string, unknown>, local: Partial<Msg>) {
  const s = st(pid); const m = s.byId.get(id); if (!m) return;
  const before = { ...m };
  Object.assign(m, local);
  s.msgs = [...s.byId.values()].filter((x) => !x.deleted).sort(byTime); s.byId = new Map(s.byId); emit(pid);
  const { error } = await sb().from('writell_messages').update(change).eq('id', id);
  if (error) { Object.assign(m, before); s.msgs = [...s.byId.values()].filter((x) => !x.deleted).sort(byTime); emit(pid); throw friendly(error); }
  sendProjectEvent(pid, 'chat');
  await refreshChat(pid);
}
export async function editMessage(pid: string, id: string, body: Body) {
  const now = new Date().toISOString();
  await patch(pid, id, { data: await encryptJSON(keyFor(pid), body), edited_at: now }, { body, edited_at: now });
}
export const removeMessage = (pid: string, id: string) => patch(pid, id, { deleted: true }, { deleted: true });
export const setResolved = (pid: string, id: string, resolved: boolean) => patch(pid, id, { resolved }, { resolved });

/** Activity lines: add to your last one about the same thing if it's recent, so the chat doesn't fill up */
export async function postActivity(pid: string, body: Body, mergeKey: string, merge: (prev: Body) => Body) {
  const uid = me();
  await refreshChat(pid);
  const s = st(pid);
  const last = s.msgs.slice(-3).reverse().find((m) => m.author === uid && m.kind === 'activity' && m.body && activityKey(m.body) === mergeKey && Date.now() - Date.parse(m.created_at) < 30 * 60_000);
  if (last?.body) await editMessage(pid, last.id, merge(last.body));
  else await post(pid, 'activity', body);
}
export const activityKey = (b: Body) => (b.type === 'edit' ? 'edit:' + b.sceneId : 'items');

/* ---------------- permissions (the server checks these too) ---------------- */
export const canModerate = (pid: string) => { const r = sharedRole(pid); return r === 'owner' || r === 'editor'; };
export const canComment = (pid: string) => { const r = sharedRole(pid); return r === 'owner' || r === 'editor' || r === 'commenter'; };

/* ---------------- unread ---------------- */
const RKEY = 'writell.chatRead';
let read: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem(RKEY) || '{}'); } catch { return {}; } })();
export function markRead(pid: string) {
  const s = store.get(pid); const last = s?.msgs[s.msgs.length - 1]?.created_at;
  if (!last || (read[pid] && read[pid] >= last)) return;
  read = { ...read, [pid]: last };
  try { localStorage.setItem(RKEY, JSON.stringify(read)); } catch { /* */ }
  ls.forEach((l) => l());
}
export function unreadCount(pid: string) {
  const s = snaps.get(pid); if (!s) return 0;
  const since = read[pid];
  if (!since) return 0; // first time here: nothing counts as new
  const uid = currentUserId();
  return s.msgs.filter((m) => m.kind !== 'activity' && m.author !== uid && m.created_at > since && !isMuted(m.author)).length;
}
export const useUnread = (pid: string | null) => useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => (pid ? unreadCount(pid) : 0), () => 0);
/** first open of a project's chat counts everything so far as read */
export function ensureReadMark(pid: string) {
  if (read[pid]) return;
  const s = store.get(pid);
  read = { ...read, [pid]: s?.msgs[s.msgs.length - 1]?.created_at ?? '1970-01-01T00:00:00.000Z' };
  try { localStorage.setItem(RKEY, JSON.stringify(read)); } catch { /* */ }
  ls.forEach((l) => l());
}

/* chats on screen right now (they mark themselves read) */
const visible = new Map<string, number>();
export function chatVisible(pid: string, on: boolean) { visible.set(pid, Math.max(0, (visible.get(pid) ?? 0) + (on ? 1 : -1))); }
export const isChatVisible = (pid: string) => (visible.get(pid) ?? 0) > 0 && document.visibilityState === 'visible';

/* ---------------- keeping up to date ---------------- */
let started = false;
export function startChat(sharedIds: () => string[]) {
  if (started) return; started = true;
  onProjectEvent((pid, ev) => { if (ev === 'chat') void refreshChat(pid); });
  const all = () => {
    const ph = getSyncStatus().phase;
    if (ph === 'signed-out' || ph === 'needs-recovery' || ph === 'paused') return;
    for (const pid of sharedIds()) void refreshChat(pid).then(() => { const s = store.get(pid); if (s?.loaded) ensureReadMark(pid); });
  };
  window.setTimeout(all, 3000);
  window.setInterval(() => { if (document.visibilityState === 'visible') all(); }, 20_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') all(); });
}
export function forgetChat(pid?: string) { if (pid) { store.delete(pid); snaps.delete(pid); } else { store.clear(); snaps.clear(); } ls.forEach((l) => l()); }
