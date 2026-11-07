/*
 * Who is where in a shared project (which scene), and following someone:
 * when the person you follow opens another scene, you go with them; inside a
 * scene your view keeps their cursor on screen. Sent encrypted over the
 * project's realtime channel.
 */
import { useSyncExternalStore } from 'react';
import { currentUserId, onProjectEvent, sendProjectEvent, sharedKey, syncNow } from '../sync/engine';
import { decryptJSON, encryptJSON } from '../sync/crypto';
import { getNav, go } from '../nav';
import { db } from '../db';

export interface Where { u: string; scene: string | null; at: number }
const people = new Map<string, Map<string, Where>>();
const ls = new Set<() => void>();
let snap: Record<string, Where[]> = {};
const STALE = 45_000;
function emit() {
  const n = Date.now(); const out: Record<string, Where[]> = {};
  for (const [pid, m] of people) out[pid] = [...m.values()].filter((w) => n - w.at < STALE && w.u !== currentUserId());
  snap = out; ls.forEach((l) => l());
}
const sub = (l: () => void) => { ls.add(l); return () => { ls.delete(l); }; };
/** People (other than you) who have this project open, and the scene they're in */
export function useProjectPeople(pid: string | null): Where[] {
  const s = useSyncExternalStore(sub, () => snap, () => snap);
  return pid ? s[pid] ?? EMPTY : EMPTY;
}
const EMPTY: Where[] = [];

/* ---------------- following ---------------- */
export interface Following { pid: string; u: string }
let following: Following | null = null;
const fls = new Set<() => void>();
export const useFollowing = () => useSyncExternalStore((l) => { fls.add(l); return () => { fls.delete(l); }; }, () => following, () => following);
export const getFollowing = () => following;
export function follow(pid: string, u: string) {
  following = { pid, u }; fls.forEach((l) => l());
  const w = people.get(pid)?.get(u);
  if (w?.scene) void goTo(pid, w.scene);
  else if (!w) void sayWhere(true);
}
export function unfollow() { if (!following) return; following = null; fls.forEach((l) => l()); }
let goingTo = '';
async function goTo(pid: string, scene: string) {
  goingTo = scene;
  // a scene they just made may take a few seconds to sync here: keep looking for a bit
  for (let i = 0; i < 20; i++) {
    if (goingTo !== scene || following?.pid !== pid) return;
    const r = getNav().route;
    if (r.view === 'write' && (r.sceneId === scene || r.splitSceneId === scene)) return;
    if (await db.scenes.get(scene)) { go({ view: 'write', projectId: pid, sceneId: scene }); return; }
    if (i === 0) void syncNow();
    await new Promise((res) => window.setTimeout(res, 1500));
  }
}

/* ---------------- telling others where you are ---------------- */
let mine: { pid: string; scene: string | null } | null = null;
async function sayWhere(hi = false) {
  if (!mine) return;
  const key = sharedKey(mine.pid); const u = currentUserId(); if (!key || !u) return;
  sendProjectEvent(mine.pid, 'where', { d: await encryptJSON(key, { u, scene: mine.scene }), hi });
}
/** Called when you move around the app */
export function setMyPlace(pid: string | null, scene: string | null) {
  const prev = mine;
  if (prev && prev.pid !== pid) { const key = sharedKey(prev.pid); const u = currentUserId(); if (key && u) void encryptJSON(key, { u, scene: null, gone: true }).then((d) => sendProjectEvent(prev.pid, 'where', { d })); }
  mine = pid && sharedKey(pid) ? { pid, scene } : null;
  if (mine && (!prev || prev.pid !== mine.pid || prev.scene !== mine.scene)) void sayWhere(!prev || prev.pid !== mine.pid);
  if (following && following.pid !== pid) unfollow();
}

let started = false;
let replyTimer = 0;
export function startPresence() {
  if (started) return; started = true;
  onProjectEvent(async (pid, ev, payload) => {
    if (ev !== 'where') return;
    const key = sharedKey(pid); const p = payload as { d?: string; hi?: boolean } | undefined;
    if (!key || !p?.d) return;
    let w: { u: string; scene: string | null; gone?: boolean };
    try { w = await decryptJSON(key, p.d); } catch { return; }
    if (!w?.u || w.u === currentUserId()) return;
    let m = people.get(pid); if (!m) { m = new Map(); people.set(pid, m); }
    if (w.gone) m.delete(w.u); else m.set(w.u, { u: w.u, scene: w.scene ?? null, at: Date.now() });
    emit();
    // someone just arrived: tell them where you are
    if (p.hi && mine?.pid === pid) { window.clearTimeout(replyTimer); replyTimer = window.setTimeout(() => void sayWhere(), 300 + Math.random() * 700); }
    if (following && following.pid === pid && following.u === w.u) {
      if (w.gone) { unfollow(); return; }
      if (w.scene) void goTo(pid, w.scene);
    }
  });
  window.setInterval(() => { if (document.visibilityState === 'visible') void sayWhere(); emit(); }, 15_000);
  window.addEventListener('pagehide', () => setMyPlace(null, null));
}
