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
import { createKeys, decryptJSON, encryptJSON, unlockWithPassword, unlockWithRecovery, rewrapWithPassword, b64, unb64, type KeyRow } from './crypto';

export const SYNCED = ['projects', 'chapters', 'scenes', 'activity', 'entities', 'links', 'files'] as const;
type Tbl = typeof SYNCED[number];
type Row = { id: string; updatedAt?: number; [k: string]: unknown };

/* ------------------------------------------------------------------ */
/* local bookkeeping (separate small database)                         */
/* ------------------------------------------------------------------ */
class SyncDB extends Dexie {
  meta!: Table<{ key: string; value: unknown }, string>;
  state!: Table<{ k: string; hash: string }, string>;
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

/** Compare everything with what was last synced (start-up / sign-in) */
async function scanAll() {
  const known = new Map((await sdb.state.toArray()).map((s) => [s.k, s.hash]));
  for (const t of SYNCED) {
    const rows = await table(t).toArray();
    for (const r of rows) {
      const k = K(t, r.id);
      if (known.get(k) !== fingerprint(t, r)) dirty.add(k);
      known.delete(k);
    }
  }
  for (const k of known.keys()) dirty.add(k); // synced before, gone now = deleted here
  setStatus({ pending: dirty.size });
}

const MAX_BATCH_BYTES = 900_000;
async function push() {
  if (!dirty.size) return;
  const keys = [...dirty];
  let batch: { user_id: string; tbl: string; id: string; deleted: boolean; data: string | null }[] = [];
  let bytes = 0;
  const done: { k: string; hash: string | null }[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const { error } = await sb().from('writell_items').upsert(batch, { onConflict: 'user_id,tbl,id' });
    if (error) throw error;
    await sdb.transaction('rw', sdb.state, async () => {
      for (const d of done) { if (d.hash === null) await sdb.state.delete(d.k); else await sdb.state.put({ k: d.k, hash: d.hash }); }
    });
    for (const d of done) dirty.delete(d.k);
    setStatus({ pending: dirty.size });
    batch = []; bytes = 0; done.length = 0;
  };
  for (const k of keys) {
    const [t, id] = k.split('\u0000') as [Tbl, string];
    const row = await table(t).get(id);
    const prev = (await sdb.state.get(k))?.hash;
    if (!row) {
      if (prev === undefined) { dirty.delete(k); continue; } // never synced: nothing to remove
      batch.push({ user_id: userId!, tbl: t, id, deleted: true, data: null });
      done.push({ k, hash: null });
    } else {
      const hash = fingerprint(t, row);
      if (hash === prev) { dirty.delete(k); continue; }
      const data = await encryptJSON(dek!, await toPlain(t, row));
      batch.push({ user_id: userId!, tbl: t, id, deleted: false, data });
      done.push({ k, hash });
      bytes += data.length;
    }
    if (bytes > MAX_BATCH_BYTES || batch.length >= 200) await flush();
  }
  await flush();
  setStatus({ pending: dirty.size });
}

const OVERLAP = 200; // re-read a few recent changes so none slip through
async function pull() {
  let since = Number((await getMeta<number>('lastSeq')) ?? 0);
  let maxSeq = since;
  let from = Math.max(0, since - OVERLAP);
  for (;;) {
    const { data, error } = await sb().from('writell_items').select('tbl,id,deleted,data,seq').gt('seq', from).order('seq', { ascending: true }).limit(300);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as { tbl: Tbl; id: string; deleted: boolean; data: string | null; seq: number }[]) {
      maxSeq = Math.max(maxSeq, r.seq);
      if (!SYNCED.includes(r.tbl)) continue;
      await applyRemote(r);
    }
    from = (data[data.length - 1] as { seq: number }).seq;
    if (data.length < 300) break;
  }
  if (maxSeq > since) await setMeta('lastSeq', maxSeq);
  since = maxSeq;
}

async function applyRemote(r: { tbl: Tbl; id: string; deleted: boolean; data: string | null }) {
  const k = K(r.tbl, r.id);
  const prev = (await sdb.state.get(k))?.hash;
  const local = await table(r.tbl).get(r.id);
  const localHash = local ? fingerprint(r.tbl, local) : undefined;
  const localChanged = local !== undefined && localHash !== prev; // edited here since last sync
  if (r.deleted) {
    if (!local) { if (prev !== undefined) await sdb.state.delete(k); return; }
    if (localChanged && prev !== undefined) return; // edited here after it was deleted elsewhere: keep it (it'll re-upload)
    await remoteTx(r.tbl, () => table(r.tbl).delete(r.id));
    await sdb.state.delete(k);
    dirty.delete(k);
    return;
  }
  if (!r.data) return;
  const plain = fromPlain(r.tbl, await decryptJSON<Row>(dek!, r.data));
  const hash = fingerprint(r.tbl, plain);
  if (hash === prev && local) return;                 // already have this version
  if (local && localHash === hash) { await sdb.state.put({ k, hash }); dirty.delete(k); return; }
  if (local && localChanged) {
    // both devices changed it: the newer edit wins
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
  await sdb.state.put({ k, hash });
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

let syncing: Promise<void> | null = null;
let again = false;
/** Upload what changed here and download what changed elsewhere */
export async function syncNow({ pullFirst = true, scan = false } = {}): Promise<void> {
  if (!running()) return;
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    setStatus({ phase: 'syncing', message: undefined });
    try {
      if (scan) await scanAll();
      if (pullFirst) await pull();
      await push();
      if (!pullFirst) await pull();
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
  if (prevUser && prevUser !== session.user.id) { await sdb.state.clear(); await setMeta('lastSeq', 0); } // a different account on this device
  dek = key; userId = session.user.id;
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
  dek = null; userId = null; dirty.clear();
  await sdb.meta.clear(); await sdb.state.clear();
  setStatus({ phase: 'signed-out', email: undefined, lastSync: undefined, pending: 0, message: undefined });
}

export async function setPaused(paused: boolean) {
  await setMeta('paused', paused);
  if (paused) { window.clearTimeout(pushTimer); setStatus({ phase: 'paused' }); }
  else { setStatus({ phase: 'synced' }); await syncNow({ scan: true }); }
}

/* ------------------------------------------------------------------ */
/* start-up                                                            */
/* ------------------------------------------------------------------ */
let started = false;
export async function startSync() {
  if (started) return; started = true;
  installHooks();
  try {
    const key = await getMeta<CryptoKey>('dek');
    const uidStored = await getMeta<string>('userId');
    const { data } = await sb().auth.getSession();
    if (!data.session || !key || !uidStored || uidStored !== data.session.user.id) { setStatus({ phase: 'signed-out' }); return; }
    dek = key; userId = uidStored;
    setStatus({ email: data.session.user.email ?? undefined, phase: (await getMeta<boolean>('paused')) ? 'paused' : 'synced' });
    await syncNow({ scan: true });
  } catch (e) {
    setStatus({ phase: navigator.onLine ? 'error' : 'offline', message: (e as Error).message });
  }
  // keep up with other devices while open
  window.setInterval(() => { if (document.visibilityState === 'visible') void syncNow(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow(); else void syncNow({ pullFirst: false }); });
  window.addEventListener('online', () => void syncNow());
}
