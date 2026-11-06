/*
 * Profiles & friends (stage A). Talks to the writell_profiles / _friendships /
 * _blocks / _presence tables; the database rules decide who can see what.
 */
import { useSyncExternalStore } from 'react';
import { currentUserId, dataKey, supabaseClient as sb, getSyncStatus } from '../sync/engine';
import { decryptJSON, encryptJSON } from '../sync/crypto';

export interface Profile { id: string; username: string; display_name: string; bio: string; avatar: string | null; public_key: string | null }
export interface Friendship { requester: string; addressee: string; status: 'pending' | 'accepted'; created_at: string; accepted_at: string | null }
export type Relation = 'self' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none';

export interface SocialState {
  ready: boolean;          // loaded at least once
  signedIn: boolean;
  me: Profile | null;      // null = no username yet
  friends: Profile[];
  incoming: Profile[];
  outgoing: Profile[];
  blocked: Profile[];
  friendships: Friendship[];
  lastSeen: Record<string, number>;  // friends' last activity (ms)
  showOnline: boolean;
  error?: string;
}
const empty: SocialState = { ready: false, signedIn: false, me: null, friends: [], incoming: [], outgoing: [], blocked: [], friendships: [], lastSeen: {}, showOnline: true };
let state: SocialState = empty;
const ls = new Set<() => void>();
const set = (p: Partial<SocialState>) => { state = { ...state, ...p }; ls.forEach((l) => l()); };
export const useSocial = () => useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => state, () => state);
export const getSocial = () => state;

const ONLINE_MS = 150_000;
export const isOnline = (id: string) => Date.now() - (state.lastSeen[id] ?? 0) < ONLINE_MS;

const me = () => { const id = currentUserId(); if (!id) throw new Error('Sign in first (Settings → Account & sync).'); return id; };
const friendly = (e: { message?: string; code?: string } | null) => {
  if (!e) return null;
  const m = e.message ?? '';
  if (e.code === '23505' && /username/.test(m)) return new Error('That username is taken. Try another.');
  if (/writell_profiles|writell_friendships|schema cache|PGRST20/.test(m)) return new Error('Friends aren’t set up in Supabase yet: run the stage A setup script.');
  if (/fetch|network/i.test(m)) return new Error('Can’t reach the server. Check your internet connection.');
  return new Error(m || 'Something went wrong.');
};

/* ---------------- loading ---------------- */
let loading: Promise<void> | null = null;
export function refreshSocial(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const uid = currentUserId();
    const ph = getSyncStatus().phase;
    if (!uid || ph === 'signed-out' || ph === 'needs-recovery') { set({ ...empty, ready: true, signedIn: false }); return; }
    try {
      const [{ data: mine, error: e1 }, { data: fr, error: e2 }, { data: bl, error: e3 }, { data: pres }] = await Promise.all([
        sb().from('writell_profiles').select('id,username,display_name,bio,avatar,public_key').eq('id', uid).maybeSingle(),
        sb().from('writell_friendships').select('requester,addressee,status,created_at,accepted_at'),
        sb().from('writell_blocks').select('blocked'),
        sb().from('writell_presence').select('visible').eq('user_id', uid).maybeSingle(),
      ]);
      const err = friendly(e1) ?? friendly(e2) ?? friendly(e3);
      if (err) throw err;
      const friendships = (fr ?? []) as Friendship[];
      const blockedIds = ((bl ?? []) as { blocked: string }[]).map((b) => b.blocked);
      const other = (f: Friendship) => (f.requester === uid ? f.addressee : f.requester);
      const ids = [...new Set([...friendships.map(other), ...blockedIds])];
      let people: Profile[] = [];
      if (ids.length) {
        const { data, error } = await sb().from('writell_profiles').select('id,username,display_name,bio,avatar,public_key').in('id', ids);
        if (error) throw friendly(error);
        people = (data ?? []) as Profile[];
      }
      const byId = new Map(people.map((p) => [p.id, p]));
      const pick = (list: string[]) => list.map((i) => byId.get(i)).filter(Boolean) as Profile[];
      const friendIds = friendships.filter((f) => f.status === 'accepted').map(other);
      const lastSeen: Record<string, number> = {};
      if (friendIds.length) {
        const { data } = await sb().from('writell_presence').select('user_id,last_seen').in('user_id', friendIds);
        for (const r of (data ?? []) as { user_id: string; last_seen: string }[]) lastSeen[r.user_id] = Date.parse(r.last_seen);
      }
      const byName = (a: Profile, b: Profile) => (a.display_name || a.username).localeCompare(b.display_name || b.username, undefined, { sensitivity: 'base' });
      set({
        ready: true, signedIn: true, error: undefined,
        me: (mine as Profile | null) ?? null,
        friendships, lastSeen,
        friends: pick(friendIds).sort(byName),
        incoming: pick(friendships.filter((f) => f.status === 'pending' && f.addressee === uid).map((f) => f.requester)),
        outgoing: pick(friendships.filter((f) => f.status === 'pending' && f.requester === uid).map((f) => f.addressee)),
        blocked: pick(blockedIds),
        showOnline: (pres as { visible?: boolean } | null)?.visible ?? true,
      });
    } catch (e) {
      set({ ready: true, signedIn: true, error: (e as Error).message });
    }
  })().finally(() => { loading = null; });
  return loading;
}

export function relationTo(id: string): Relation {
  const uid = currentUserId();
  if (id === uid) return 'self';
  if (state.blocked.some((p) => p.id === id)) return 'blocked';
  const f = state.friendships.find((x) => (x.requester === id && x.addressee === uid) || (x.addressee === id && x.requester === uid));
  if (!f) return 'none';
  if (f.status === 'accepted') return 'friend';
  return f.requester === uid ? 'outgoing' : 'incoming';
}
export const friendsSince = (id: string) => state.friendships.find((f) => f.status === 'accepted' && (f.requester === id || f.addressee === id))?.accepted_at ?? null;

/* ---------------- your profile ---------------- */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export async function usernameTaken(name: string): Promise<boolean> {
  const { data } = await sb().from('writell_profiles').select('id').eq('username', name).maybeSingle();
  return !!data && (data as { id: string }).id !== currentUserId();
}
export async function saveProfile(p: { username: string; display_name: string; bio: string; avatar: string | null }) {
  const uid = me();
  const row = { id: uid, username: p.username.trim().toLowerCase(), display_name: p.display_name.trim(), bio: p.bio.trim(), avatar: p.avatar, updated_at: new Date().toISOString() };
  const { error } = state.me
    ? await sb().from('writell_profiles').update(row).eq('id', uid)
    : await sb().from('writell_profiles').insert(row);
  if (error) throw friendly(error);
  await ensureKeyPair().catch(() => { /* retried next time */ });
  await refreshSocial();
}
export async function setShowOnline(visible: boolean) {
  const uid = me();
  const { error } = await sb().from('writell_presence').upsert({ user_id: uid, last_seen: new Date().toISOString(), visible });
  if (error) throw friendly(error);
  set({ showOnline: visible });
}

/** A key pair for sharing projects privately (stage B): public half on your profile, private half locked with your data key */
async function ensureKeyPair() {
  const uid = me(); const dek = dataKey(); if (!dek) return;
  const { data } = await sb().from('writell_keys').select('priv').eq('user_id', uid).maybeSingle();
  const prof = (await sb().from('writell_profiles').select('public_key').eq('id', uid).maybeSingle()).data as { public_key: string | null } | null;
  if ((data as { priv?: string | null } | null)?.priv && prof?.public_key) {
    try { await decryptJSON(dek, (data as { priv: string }).priv); return; } catch { /* unreadable: make a new pair */ }
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await sb().from('writell_keys').update({ priv: await encryptJSON(dek, priv) }).eq('user_id', uid);
  await sb().from('writell_profiles').update({ public_key: JSON.stringify(pub) }).eq('id', uid);
}

/* ---------------- finding people ---------------- */
export async function searchPeople(q: string): Promise<Profile[]> {
  const clean = q.trim().replace(/^@/, '').replace(/[^\p{L}\p{N}_ .'-]/gu, '').slice(0, 40);
  if (clean.length < 2) return [];
  const uname = clean.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const ors = [`display_name.ilike.%${clean}%`];
  if (uname) ors.unshift(`username.ilike.${uname}%`);
  const { data, error } = await sb().from('writell_profiles').select('id,username,display_name,bio,avatar,public_key').or(ors.join(',')).neq('id', me()).limit(20);
  if (error) throw friendly(error);
  return (data ?? []) as Profile[];
}
export async function getProfile(id: string): Promise<Profile | null> {
  const { data } = await sb().from('writell_profiles').select('id,username,display_name,bio,avatar,public_key').eq('id', id).maybeSingle();
  return (data as Profile | null) ?? null;
}

/* ---------------- friend actions ---------------- */
export async function sendRequest(id: string) {
  const uid = me();
  if (relationTo(id) === 'incoming') return accept(id); // they already asked: just accept
  const { error } = await sb().from('writell_friendships').insert({ requester: uid, addressee: id, status: 'pending' });
  if (error && error.code === '23505') { await refreshSocial(); if (relationTo(id) === 'incoming') return accept(id); }
  else if (error) throw friendly(error);
  await refreshSocial();
}
export async function accept(id: string) {
  const { error } = await sb().from('writell_friendships').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('requester', id).eq('addressee', me());
  if (error) throw friendly(error);
  await refreshSocial();
}
/** decline a request, cancel yours, or remove a friend */
export async function unfriend(id: string) {
  const uid = me();
  const a = await sb().from('writell_friendships').delete().eq('requester', uid).eq('addressee', id);
  const b = await sb().from('writell_friendships').delete().eq('requester', id).eq('addressee', uid);
  const err = friendly(a.error) ?? friendly(b.error); if (err) throw err;
  await refreshSocial();
}
export async function block(id: string) {
  await unfriend(id).catch(() => {});
  const { error } = await sb().from('writell_blocks').insert({ blocker: me(), blocked: id });
  if (error && error.code !== '23505') throw friendly(error);
  await refreshSocial();
}
export async function unblock(id: string) {
  const { error } = await sb().from('writell_blocks').delete().eq('blocker', me()).eq('blocked', id);
  if (error) throw friendly(error);
  await refreshSocial();
}

/* ---------------- staying up to date ---------------- */
let timer = 0, beat = 0;
async function heartbeat() {
  const uid = currentUserId();
  if (!uid || !state.me || document.visibilityState !== 'visible') return;
  await sb().from('writell_presence').upsert({ user_id: uid, last_seen: new Date().toISOString(), visible: state.showOnline });
}
/** Called once at start-up: keeps friends, requests and online status fresh while Writell is open */
export function startSocial() {
  if (timer) return;
  const tick = () => { void refreshSocial().then(heartbeat); };
  window.setTimeout(tick, 2500);
  timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshSocial(); }, 45_000);
  beat = window.setInterval(() => { void heartbeat(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  void beat;
}
