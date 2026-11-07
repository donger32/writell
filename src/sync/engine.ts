/*
 * Account sync.
 *
 * Every row of your projects (projects, chapters, scenes, characters & other
 * entries, links, word-count history, pictures) is encrypted on this device
 * and stored in your Supabase account as one opaque row per item.
 *
 * - Push: changes are noticed as they are saved (Dexie hooks) and uploaded a
 *   couple of seconds later. A full comparison also runs at start-up, so
 *   nothing is missed if the app closed before an upload.
 * - Pull: other devices' changes are fetched by sequence number ("what changed
 *   since #123?") at start-up, every 30 s while the app is open, when it comes
 *   back to the foreground and when the internet comes back.
 * - Conflicts: if the same item changed on two devices, the newer edit wins;
 *   for scenes the losing text is kept in the scene's History ("Before sync").
 * - Deleting syncs too (as a "deleted" marker).
 * Revision history snapshots, in-app backups and the trash stay on each device.
 */
import Dexie, { type Table } from 'dexie';
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { db, uid, now } from '../db';
import { SUPABASE_KEY, SUPABASE_URL, WEB_APP_URL } from './config';
import { mergeStates } from './ydoc';
import { createKeys, decryptJSON, encryptJSON, unlockWithPassword, unlockWithRecovery, rewrapWithPassword, b64, unb64, importPrivateJwk, importProjectKey, openSealed, type KeyRow } from './crypto';

export const SYNCED = ['projects', 'chapters', 'scenes', 'activity', 'entities', 'links', 'files'] as const;
type Tbl = typeof SYNCED[number];
type Row = { id: string; updatedAt?: number; [k: string]: unknown };

/* ------------------------------------------------------------------ */
/* local bookkeeping (separate small database)                         */
/* ------------------------------------------------------------------ */
class SyncDB extends Dexie {
  meta!: Table<{ key: string; value: unknown }, string>;
  state!: Table<{ k: string; hash: string; pid?: string; dest?: string }, string>;
  constructor() { super('writell-sync'); this.version(1).stores({ meta: 'key', state: 'k' }); }
}
const sdb = new SyncDB();
const getMeta = async <T>(key: string) => (await sdb.meta.get(key))?.value as T | undefined;
const setMeta = (key: string, value: unknown) => sdb.meta.put({ key, value });

/* ------------------------------------------------------------------ */
/* status for the UI                                                   */
/* ------------------------------------------------------------------ */
export type Phase = 'signed-out' | 'needs-recovery' | 'paused' | 'syncing' | 'synced' | 'offline' | 'error' | 'setup-missing';
export interface SyncStatus { phase: Phase; email?: string; lastSync?: number; message?: string; pending: number }
let status: SyncStatus = { phase: 'signed-out', pending: 0 };
const listeners = new Set<() => void>();
const setStatus = (p: Partial<SyncStatus>) => { status = { ...status, ...p }; listeners.forEach((l) => l()); };
export const getSyncStatus = () => status;
export const useSyncStatus = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => status, () => status);

/* ------------------------------------------------------------------ */
/* Supabase client                                                     */
/* ------------------------------------------------------------------ */
let client: SupabaseClient | null = null;
const sb = () => (client ??= createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'writell.auth' } }));

let dek: CryptoKey | null = null;
let userId: string | null = null;

/* ------------------------------------------------------------------ */
/* rows <-> plain JSON (pictures are Blobs locally)                    */
/* ------------------------------------------------------------------ */
async function toPlain(tbl: Tbl, row: Row): Promise<Row> {
  if (tbl === 'files' && row.data instanceof Blob) {
    const buf = new Uint8Array(await row.data.arrayBuffer());
    return { ...row, data: { __blob: b64(buf), type: row.data.type } };
  }
  return row;
}
function fromPlain(tbl: Tbl, row: Row): Row {
  const d = row.data as { __blob?: string; type?: string } | undefined;
  if (tbl === 'files' && d && typeof d === 'object' && typeof d.__blob === 'string') return { ...row, data: new Blob([unb64(d.__blob) as BlobPart], { type: d.type ?? '' }) };
  return row;
}
/** Fingerprint used to tell whether a row changed since it was last synced */
function fingerprint(tbl: Tbl, row: Row): string {
  const s = tbl === 'files' && row.data instanceof Blob
    ? JSON.stringify({ ...row, data: { size: row.data.size, type: row.data.type } })
    : JSON.stringify(row, (_k, v) => (v instanceof Blob ? { size: v.size, type: v.type } : v));
  // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + s.length;
}
const K = (tbl: string, id: string) => tbl + '\u0000' + id;
const table = (t: Tbl) => db[t] as unknown as Table<Row, string>;

/* ------------------------------------------------------------------ */
/* noticing local changes                                              */
/* ------------------------------------------------------------------ */
const dirty = new Set<string>();
const REMOTE = '__writellRemote';
let pushTimer = 0;
function markDirty(tbl: Tbl, id: unknown, tx: unknown) {
  if (typeof id !== 'string') return;
  if ((tx as Record<string, unknown> | undefined)?.[REMOTE]) return; // our own download, not an edit
  dirty.add(K(tbl, id));
  setStatus({ pending: dirty.size });
  schedulePush();
}
function schedulePush(ms = 2000) {
  if (!running()) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { void syncNow({ pullFirst: false }); }, ms);
}
let hooked = false;
function installHooks() {
  if (hooked) return; hooked = true;
  for (const t of SYNCED) {
    const tb = table(t);
    tb.hook('creating', function (primKey, obj, tx) { markDirty(t, primKey ?? (obj as Row).id, tx); });
    tb.hook('updating', function (_mods, primKey, _obj, tx) { markDirty(t, primKey, tx); });
    tb.hook('deleting', function (primKey, _obj, tx) { markDirty(t, primKey, tx); });
  }
}

/* ------------------------------------------------------------------ */
/* push / pull                                                         */
/* ------------------------------------------------------------------ */
const running = () => !!(dek && userId && status.phase !== 'paused' && status.phase !== 'signed-out' && status.phase !== 'needs-recovery');

/* ------------------------------------------------------------------ */
/* shared projects                                                     */
/* ------------------------------------------------------------------ */
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
interface SharedInfo { role: Role; key: CryptoKey }
/** projects shared with / by you: id → your role and the project's key */
const shared = new Map<string, SharedInfo>();
const sharedListeners = new Set<() => void>();
let sharedSnapshot: Record<string, Role> = {};
const emitShared = () => { sharedSnapshot = Object.fromEntries([...shared].map(([k, v]) => [k, v.role])); sharedListeners.forEach((l) => l()); };
/** { projectId: your role } for every shared project, re-rendering on change */
export const useSharedRoles = () => useSyncExternalStore((l) => { sharedListeners.add(l); return () => sharedListeners.delete(l); }, () => sharedSnapshot, () => sharedSnapshot);
export const sharedRole = (projectId: string): Role | undefined => shared.get(projectId)?.role;
export const sharedKey = (projectId: string) => shared.get(projectId)?.key;
export const canEdit = (projectId: string) => { const r = shared.get(projectId)?.role; return !r || r === 'owner' || r === 'editor'; };
async function saveShared() {
  await setMeta('shared', [...shared].map(([pid, v]) => ({ pid, role: v.role, key: v.key })));
  emitShared();
}
const pidOf = (t: Tbl, row: Row) => (t === 'projects' ? row.id : String(row.projectId ?? ''));
/** where a row is stored: '' = your private space, otherwise the shared project's id */
const destOf = (t: Tbl, pid: string) => (t !== 'activity' && pid && shared.has(pid) ? pid : '');
type StateRow = { k: string; hash: string; pid?: string; dest?: string };

/** Compare everything with what was last synced (start-up / sign-in) */
async function scanAll(onlyProject?: string) {
  const known = new Map((await sdb.state.toArray()).map((s) => [s.k, s as StateRow]));
  for (const t of SYNCED) {
    const rows = await table(t).toArray();
    for (const r of rows) {
      const k = K(t, r.id);
      const st = known.get(k);
      const pid = pidOf(t, r);
      if (onlyProject && pid !== onlyProject) { known.delete(k); continue; }
      if (st?.hash !== fingerprint(t, r) || (st?.dest ?? '') !== destOf(t, pid)) dirty.add(k);
      known.delete(k);
    }
  }
  if (!onlyProject) for (const k of known.keys()) dirty.add(k); // synced before, gone now = deleted here
  setStatus({ pending: dirty.size });
}

type ItemRow = { tbl: string; id: string; deleted: boolean; data: string | null };
const MAX_BATCH_BYTES = 900_000;
const readOnlyEdits = new Set<string>();
async function push() {
  if (!dirty.size) return;
  const keys = [...dirty];
  // one batch per destination (your private space, or a shared project)
  const batches = new Map<string, { rows: ItemRow[]; done: { k: string; st: StateRow | null }[]; bytes: number }>();
  const pinged = new Set<string>();
  const flush = async (dest: string) => {
    const b = batches.get(dest); if (!b || !b.rows.length) return;
    const { error } = dest
      ? await sb().from('writell_shared_items').upsert(b.rows.map((r) => ({ ...r, project_id: dest, updated_by: userId })), { onConflict: 'project_id,tbl,id' })
      : await sb().from('writell_items').upsert(b.rows.map((r) => ({ ...r, user_id: userId })), { onConflict: 'user_id,tbl,id' });
    if (error) throw error;
    await sdb.transaction('rw', sdb.state, async () => {
      for (const d of b.done) { if (d.st === null) await sdb.state.delete(d.k); else await sdb.state.put(d.st); }
    });
    for (const d of b.done) if (!b.done.some((x) => x.k === d.k && x !== d && x.st !== null && d.st === null)) dirty.delete(d.k);
    if (dest) pinged.add(dest);
    batches.delete(dest);
    setStatus({ pending: dirty.size });
  };
  const add = async (dest: string, row: ItemRow, st: StateRow | null, k: string) => {
    const b = batches.get(dest) ?? { rows: [], done: [], bytes: 0 };
    batches.set(dest, b);
    b.rows.push(row); b.done.push({ k, st }); b.bytes += row.data?.length ?? 0;
    if (b.bytes > MAX_BATCH_BYTES || b.rows.length >= 200) await flush(dest);
  };
  for (const k of keys) {
    const [t, id] = k.split('\u0000') as [Tbl, string];
    const row = await table(t).get(id);
    const prev = (await sdb.state.get(k)) as StateRow | undefined;
    const pid = row ? pidOf(t, row) : prev?.pid ?? '';
    const dest = row ? destOf(t, pid) : prev?.dest ?? '';
    if (dest && !canEdit(dest)) { readOnlyEdits.add(k); dirty.delete(k); continue; } // viewers can't change shared projects
    if (!row) {
      if (prev === undefined) { dirty.delete(k); continue; } // never synced: nothing to remove
      if (dest && !shared.has(dest)) { await sdb.state.delete(k); dirty.delete(k); continue; } // project no longer shared with you
      await add(dest, { tbl: t, id, deleted: true, data: null }, null, k);
      continue;
    }
    const hash = fingerprint(t, row);
    if (hash === prev?.hash && (prev?.dest ?? '') === dest) { dirty.delete(k); continue; }
    if (prev && (prev.dest ?? '') !== dest && !(prev.dest && !shared.has(prev.dest))) {
      // moved (e.g. a project you just shared): remove the old copy where it was
      await add(prev.dest ?? '', { tbl: t, id, deleted: true, data: null }, { k, hash: '', pid, dest }, k);
    }
    const key = dest ? shared.get(dest)!.key : dek!;
    const data = await encryptJSON(key, await toPlain(t, row));
    await add(dest, { tbl: t, id, deleted: false, data }, { k, hash, pid, dest }, k);
  }
  for (const dest of [...batches.keys()]) await flush(dest);
  for (const p of pinged) ping(p);
  setStatus({ pending: dirty.size });
  if (readOnlyEdits.size) await revertReadOnly();
}

/** A viewer/commenter changed something locally: put the shared version back */
async function revertReadOnly() {
  const keys = [...readOnlyEdits]; readOnlyEdits.clear();
  for (const k of keys) {
    const [t, id] = k.split('\u0000') as [Tbl, string];
    const st = (await sdb.state.get(k)) as StateRow | undefined;
    const pid = st?.dest || (await table(t).get(id).then((r) => (r ? pidOf(t, r) : '')));
    const info = pid && shared.get(pid); if (!info) continue;
    const { data } = await sb().from('writell_shared_items').select('tbl,id,deleted,data').eq('project_id', pid).eq('tbl', t).eq('id', id).maybeSingle();
    if (data) await applyRemote(data as ItemRow & { tbl: Tbl }, info.key, pid, true);
    else await remoteTx(t, () => table(t).delete(id)); // they added something new: take it away again
  }
}

const OVERLAP = 200; // re-read a few recent changes so none slip through
async function pull() {
  const since = Number((await getMeta<number>('lastSeq')) ?? 0);
  let maxSeq = since;
  let from = Math.max(0, since - OVERLAP);
  for (;;) {
    const { data, error } = await sb().from('writell_items').select('tbl,id,deleted,data,seq').gt('seq', from).order('seq', { ascending: true }).limit(300);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as (ItemRow & { tbl: Tbl; seq: number })[]) {
      maxSeq = Math.max(maxSeq, r.seq);
      if (!SYNCED.includes(r.tbl)) continue;
      await applyRemote(r, dek!, '');
    }
    from = (data[data.length - 1] as { seq: number }).seq;
    if (data.length < 300) break;
  }
  if (maxSeq > since) await setMeta('lastSeq', maxSeq);
}

/** Everything that changed in your shared projects (or all of one project, after joining it) */
async function pullShared(onlyProject?: string) {
  if (!shared.size) return;
  const since = onlyProject ? 0 : Number((await getMeta<number>('sharedSeq')) ?? 0);
  let maxSeq = since;
  let from = Math.max(0, since - OVERLAP);
  for (;;) {
    let q = sb().from('writell_shared_items').select('project_id,tbl,id,deleted,data,seq').gt('seq', from);
    if (onlyProject) q = q.eq('project_id', onlyProject);
    const { data, error } = await q.order('seq', { ascending: true }).limit(300);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as (ItemRow & { tbl: Tbl; seq: number; project_id: string })[]) {
      maxSeq = Math.max(maxSeq, r.seq);
      const info = shared.get(r.project_id);
      if (!info || !SYNCED.includes(r.tbl)) continue;
      await applyRemote(r, info.key, r.project_id);
    }
    from = (data[data.length - 1] as { seq: number }).seq;
    if (data.length < 300) break;
  }
  if (!onlyProject && maxSeq > since) await setMeta('sharedSeq', maxSeq);
}

async function applyRemote(r: { tbl: Tbl; id: string; deleted: boolean; data: string | null }, key: CryptoKey, dest: string, force = false) {
  const k = K(r.tbl, r.id);
  const st = (await sdb.state.get(k)) as StateRow | undefined;
  const prev = st?.hash;
  const local = await table(r.tbl).get(r.id);
  const localHash = local ? fingerprint(r.tbl, local) : undefined;
  // a leftover from your private space for a project that is now shared: ignore it
  if (!dest && local && destOf(r.tbl, pidOf(r.tbl, local))) return;
  if (!dest && !local && st?.dest) return;
  const localChanged = !force && local !== undefined && localHash !== prev; // edited here since last sync
  if (r.deleted) {
    if (!local) { if (prev !== undefined) await sdb.state.delete(k); return; }
    if (localChanged && prev !== undefined) return; // edited here after it was deleted elsewhere: keep it (it'll re-upload)
    await remoteTx(r.tbl, () => table(r.tbl).delete(r.id));
    await sdb.state.delete(k);
    dirty.delete(k);
    return;
  }
  if (!r.data) return;
  const plain = fromPlain(r.tbl, await decryptJSON<Row>(key, r.data));
  const hash = fingerprint(r.tbl, plain);
  const pid = pidOf(r.tbl, plain);
  if (hash === prev && local && !force) return;                 // already have this version
  if (local && localHash === hash) { await sdb.state.put({ k, hash, pid, dest }); dirty.delete(k); return; }
  // live co-writing scenes: combine both versions instead of choosing one
  const ly = (local as { ystate?: string } | undefined)?.ystate, ry = (plain as { ystate?: string }).ystate;
  if (r.tbl === 'scenes' && local && ly && ry && ly !== ry) {
    const m = mergeStates(ly, ry);
    if (!m.same) {
      const words = (jsonText(m.content).match(/\S+/g) ?? []).length;
      const merged = { ...plain, content: m.content, ystate: m.ystate, words, updatedAt: Math.max(Number(local.updatedAt ?? 0), Number(plain.updatedAt ?? 0)) };
      await remoteTx('scenes', () => table('scenes').put(merged));
      await sdb.state.put({ k, hash, pid, dest }); // remember theirs; ours (the merge) goes up next
      dirty.add(k); schedulePush(300);
      window.dispatchEvent(new CustomEvent('writell:remote-scene', { detail: plain.id }));
      return;
    }
  }
  if (local && localChanged) {
    // both changed it: the newer edit wins
    const lu = Number(local.updatedAt ?? 0), ru = Number(plain.updatedAt ?? 0);
    if (lu > ru) { dirty.add(k); return; }
  }
  if (local && localChanged && r.tbl === 'scenes' && (local as { content?: unknown }).content !== undefined
      && JSON.stringify((local as { content?: unknown }).content) !== JSON.stringify((plain as { content?: unknown }).content)) {
    // keep the text this device had, just in case
    const sc = local as unknown as { id: string; projectId: string; content: unknown; words: number };
    await remoteTx('scenes', () => db.snapshots.add({ id: uid(), projectId: sc.projectId, sceneId: sc.id, content: sc.content, words: sc.words, reason: 'before-sync', createdAt: now() }));
  }
  await remoteTx(r.tbl, () => table(r.tbl).put(plain));
  await sdb.state.put({ k, hash, pid, dest });
  dirty.delete(k);
  if (r.tbl === 'scenes') window.dispatchEvent(new CustomEvent('writell:remote-scene', { detail: plain.id }));
}

/** Write downloaded data without it counting as a local edit */
async function remoteTx(t: Tbl, fn: () => Promise<unknown>) {
  await db.transaction('rw', [table(t), db.snapshots], async (tx) => {
    (tx as unknown as Record<string, unknown>)[REMOTE] = true;
    await fn();
  });
}

/* ---- which projects are shared with you ---- */
let myPriv: CryptoKey | null = null;
async function myPrivateKey(): Promise<CryptoKey | null> {
  if (myPriv) return myPriv;
  const { data } = await sb().from('writell_keys').select('priv').maybeSingle();
  const priv = (data as { priv?: string | null } | null)?.priv;
  if (!priv) return null;
  myPriv = await importPrivateJwk(await decryptJSON<JsonWebKey>(dek!, priv));
  return myPriv;
}
let membershipsMissing = false;
async function refreshMemberships() {
  const { data, error } = await sb().from('writell_members').select('project_id,role,key_grant').eq('user_id', userId!);
  if (error) { if (/writell_members|schema cache|PGRST20/.test(error.message)) { membershipsMissing = true; return; } throw error; }
  membershipsMissing = false;
  const rows = (data ?? []) as { project_id: string; role: Role; key_grant: string | null }[];
  const seen = new Set<string>();
  let changed = false;
  for (const m of rows) {
    seen.add(m.project_id);
    const have = shared.get(m.project_id);
    if (have) { if (have.role !== m.role) { have.role = m.role; changed = true; } continue; }
    if (!m.key_grant) continue; // joined by link on another device that hasn't stored its key yet
    const priv = await myPrivateKey(); if (!priv) continue;
    let key: CryptoKey;
    try { key = await importProjectKey(await openSealed(priv, m.key_grant)); } catch { continue; }
    shared.set(m.project_id, { role: m.role, key }); changed = true;
    const isNew = !(await db.projects.get(m.project_id));
    await pullShared(m.project_id);
    await scanAll(m.project_id); // anything of yours in it now goes to the shared copy
    if (isNew) window.dispatchEvent(new CustomEvent('writell:shared-added', { detail: m.project_id }));
  }
  for (const pid of [...shared.keys()]) {
    if (seen.has(pid)) continue;
    // you left or were removed: the project disappears from this device
    shared.delete(pid); changed = true;
    const title = (await db.projects.get(pid))?.title ?? 'A shared project';
    await dropLocalProject(pid);
    window.dispatchEvent(new CustomEvent('writell:shared-removed', { detail: { id: pid, title } }));
  }
  if (changed) { await saveShared(); subscribePings(); }
}
async function dropLocalProject(pid: string) {
  for (const t of SYNCED) {
    const rows = t === 'projects' ? (await db.projects.where('id').equals(pid).toArray()) as unknown as Row[] : await table(t).filter((r) => r.projectId === pid).toArray();
    await remoteTx(t, () => table(t).bulkDelete(rows.map((r) => r.id)));
    for (const r of rows) { await sdb.state.delete(K(t, r.id)); dirty.delete(K(t, r.id)); }
  }
}

async function loadShared() {
  shared.clear();
  for (const s of (await getMeta<{ pid: string; role: Role; key: CryptoKey }[]>('shared')) ?? []) shared.set(s.pid, { role: s.role, key: s.key });
  emitShared(); subscribePings();
}

/** Start sharing a project you own (called by the Share dialog after creating it on the server) */
export async function adoptShared(pid: string, role: Role, key: CryptoKey, fetchAll = false) {
  shared.set(pid, { role, key });
  await saveShared(); subscribePings();
  if (fetchAll) await pullShared(pid);
  await scanAll(pid);
  await syncNow({ pullFirst: false });
}
/** Stop syncing a shared project here. keep = turn it back into your private project */
export async function forgetShared(pid: string, keep: boolean) {
  shared.delete(pid); await saveShared(); subscribePings();
  if (keep) { await scanAll(pid); await syncNow({ pullFirst: false }); } else await dropLocalProject(pid);
}

/* ---- "something changed" pings between people in a shared project ---- */
let channels = new Map<string, ReturnType<SupabaseClient['channel']>>();
let pingTimer = 0;
function subscribePings() {
  for (const [pid, ch] of channels) if (!shared.has(pid)) { void sb().removeChannel(ch); channels.delete(pid); }
  for (const pid of shared.keys()) {
    if (channels.has(pid)) continue;
    try {
      const ch = sb().channel('writell-p-' + pid, { config: { broadcast: { self: false } } });
      ch.on('broadcast', { event: 'changed' }, () => { window.clearTimeout(pingTimer); pingTimer = window.setTimeout(() => void syncNow(), 600); });
      ch.subscribe();
      channels.set(pid, ch);
    } catch { /* realtime unavailable: the regular check still runs */ }
  }
}
function ping(pid: string) { try { void channels.get(pid)?.send({ type: 'broadcast', event: 'changed', payload: {} }); } catch { /* */ } }
void channels; channels = channels;

let syncing: Promise<void> | null = null;
let again = false;
/** Upload what changed here and download what changed elsewhere */
export async function syncNow({ pullFirst = true, scan = false } = {}): Promise<void> {
  if (!running()) return;
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    setStatus({ phase: 'syncing', message: undefined });
    try {
      await refreshMemberships();
      if (scan) await scanAll();
      if (pullFirst) { await pullShared(); await pull(); }
      await push();
      if (!pullFirst) { await pullShared(); await pull(); }
      setStatus({ phase: 'synced', lastSync: Date.now(), message: undefined });
    } catch (e) {
      const msg = (e as { message?: string }).message ?? String(e);
      const offline = !navigator.onLine || /fetch|network|Failed to fetch|Load failed/i.test(msg);
      const missing = /writell_items|writell_keys|relation .* does not exist|schema cache|PGRST20/i.test(msg);
      setStatus({ phase: missing ? 'setup-missing' : offline ? 'offline' : 'error', message: msg });
    } finally {
      syncing = null;
      if (again) { again = false; void syncNow(); }
    }
  })();
  return syncing;
}
void membershipsMissing;

/* ------------------------------------------------------------------ */
/* accounts                                                            */
/* ------------------------------------------------------------------ */
async function loadKeyRow(): Promise<KeyRow | null> {
  const { data, error } = await sb().from('writell_keys').select('salt,wrapped,rsalt,rwrapped').maybeSingle();
  if (error) throw error;
  return (data as KeyRow | null) ?? null;
}

async function begin(session: Session, key: CryptoKey) {
  const prevUser = await getMeta<string>('userId');
  if (prevUser && prevUser !== session.user.id) { await sdb.state.clear(); await setMeta('lastSeq', 0); await setMeta('sharedSeq', 0); await setMeta('shared', []); } // a different account on this device
  dek = key; userId = session.user.id; myPriv = null;
  await loadShared();
  await setMeta('dek', key); await setMeta('userId', userId);
  setStatus({ phase: 'synced', email: session.user.email ?? undefined, message: undefined });
  await syncNow({ scan: true });
}

/** Create an account. Returns 'confirm' when Supabase wants the email confirmed first. */
export async function signUp(email: string, password: string): Promise<'confirm' | { recovery: string }> {
  const redirect = location.protocol === 'https:' ? location.origin : WEB_APP_URL;
  const { data, error } = await sb().auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
  if (error) throw error;
  if (!data.session) return 'confirm';
  return finishSignIn(data.session, password) as Promise<{ recovery: string }>;
}

/** Sign in. The first time on a new account, returns the new recovery key to show once. */
export async function signIn(email: string, password: string): Promise<{ recovery?: string } | 'needs-recovery'> {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return finishSignIn(data.session!, password);
}

let pendingPassword: string | null = null;
async function finishSignIn(session: Session, password: string): Promise<{ recovery?: string } | 'needs-recovery'> {
  setStatus({ email: session.user.email ?? undefined });
  const row = await loadKeyRow();
  if (!row) {
    const k = await createKeys(password);
    const { error } = await sb().from('writell_keys').insert({ user_id: session.user.id, ...k.row });
    if (error) throw error;
    await begin(session, k.dek);
    return { recovery: k.recovery };
  }
  try {
    await begin(session, await unlockWithPassword(row, password));
    return {};
  } catch {
    // password was reset by email: the old lock no longer opens; the recovery key can
    pendingPassword = password;
    setStatus({ phase: 'needs-recovery' });
    return 'needs-recovery';
  }
}

export async function applyRecoveryKey(recovery: string) {
  const { data } = await sb().auth.getSession();
  if (!data.session || !pendingPassword) throw new Error('Sign in again first.');
  const row = await loadKeyRow();
  if (!row) throw new Error('No key found for this account.');
  let res;
  try { res = await unlockWithRecovery(row, recovery, pendingPassword); } catch { throw new Error('That recovery key doesn’t match this account.'); }
  const { error } = await sb().from('writell_keys').update(res.row).eq('user_id', data.session.user.id);
  if (error) throw error;
  pendingPassword = null;
  await begin(data.session, res.dek);
}

export async function changePassword(oldPassword: string, newPassword: string) {
  const row = await loadKeyRow();
  if (!row) throw new Error('No key found for this account.');
  let next;
  try { next = await rewrapWithPassword(row, oldPassword, newPassword); } catch { throw new Error('Your current password is not right.'); }
  const { error: e1 } = await sb().auth.updateUser({ password: newPassword });
  if (e1) throw e1;
  const { error: e2 } = await sb().from('writell_keys').update(next).eq('user_id', userId!);
  if (e2) throw e2;
}

export async function sendPasswordReset(email: string) {
  const redirect = location.protocol === 'https:' ? location.origin : WEB_APP_URL;
  const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: redirect });
  if (error) throw error;
}

/** Sign out on this device. Your projects stay here; they just stop syncing. */
export async function signOut() {
  window.clearTimeout(pushTimer);
  try { await sb().auth.signOut(); } catch { /* offline: still forget locally */ }
  dek = null; userId = null; dirty.clear(); myPriv = null; shared.clear(); emitShared(); subscribePings();
  await sdb.meta.clear(); await sdb.state.clear();
  setStatus({ phase: 'signed-out', email: undefined, lastSync: undefined, pending: 0, message: undefined });
}

export async function setPaused(paused: boolean) {
  await setMeta('paused', paused);
  if (paused) { window.clearTimeout(pushTimer); setStatus({ phase: 'paused' }); }
  else { setStatus({ phase: 'synced' }); await syncNow({ scan: true }); }
}

/** For the friends / sharing features: the signed-in connection, your id and data key */
export const supabaseClient = () => sb();
export const currentUserId = () => userId;
export const dataKey = () => dek;

/* ------------------------------------------------------------------ */
/* start-up                                                            */
/* ------------------------------------------------------------------ */
let started = false;
export async function startSync() {
  if (started) return; started = true;
  installHooks();
  // keep up with other devices while open (set up first, so it also works after signing in later)
  // every 30 s, or every 8 s while you have shared projects (friends' changes also arrive instantly when realtime works)
  let lastTick = 0;
  window.setInterval(() => { const gap = shared.size ? 8_000 : 30_000; if (document.visibilityState === 'visible' && Date.now() - lastTick >= gap) { lastTick = Date.now(); void syncNow(); } }, 4_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow(); else void syncNow({ pullFirst: false }); });
  window.addEventListener('online', () => void syncNow());
  try {
    const key = await getMeta<CryptoKey>('dek');
    const uidStored = await getMeta<string>('userId');
    const { data } = await sb().auth.getSession();
    if (!data.session || !key || !uidStored || uidStored !== data.session.user.id) { setStatus({ phase: 'signed-out' }); return; }
    dek = key; userId = uidStored;
    await loadShared();
    setStatus({ email: data.session.user.email ?? undefined, phase: (await getMeta<boolean>('paused')) ? 'paused' : 'synced' });
    await syncNow({ scan: true });
  } catch (e) {
    setStatus({ phase: navigator.onLine ? 'error' : 'offline', message: (e as Error).message });
  }
}

/** Plain text of an editor document (for word counts) */
function jsonText(n: unknown): string {
  if (!n || typeof n !== 'object') return '';
  const o = n as { text?: string; content?: unknown[] };
  return (o.text ?? '') + ' ' + (o.content ?? []).map(jsonText).join(' ');
}
