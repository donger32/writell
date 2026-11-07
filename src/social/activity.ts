/*
 * "Who changed what" lines in a shared project's chat: scenes you wrote in
 * (words added / removed) and chapters, scenes or entries you added or removed.
 * Only your own changes are reported, and only if you can edit the project.
 */
import { db } from '../db';
import { isRemoteTx, sharedRole } from '../sync/engine';
import { postActivity, type Body, type ItemRef } from './chat';

const canPost = (pid: string) => { const r = sharedRole(pid); return r === 'owner' || r === 'editor'; };

/* ---------------- writing in a scene ---------------- */
const edits = new Map<string, { pid: string; scene: string; added: number; removed: number; timer: number }>();
const IDLE = 45_000;
/** The editor reports your own typing here (positive = words added, negative = removed) */
export function noteEdit(pid: string, sceneId: string, scene: string, words: number) {
  if (!canPost(pid) || !words) return;
  let e = edits.get(sceneId);
  if (!e) { e = { pid, scene, added: 0, removed: 0, timer: 0 }; edits.set(sceneId, e); }
  e.scene = scene || e.scene;
  if (words > 0) e.added += words; else e.removed -= words;
  window.clearTimeout(e.timer);
  e.timer = window.setTimeout(() => void flushEdit(sceneId), IDLE);
}
export async function flushEdit(sceneId: string) {
  const e = edits.get(sceneId); if (!e) return;
  edits.delete(sceneId); window.clearTimeout(e.timer);
  if (!e.added && !e.removed) return;
  const body: Body = { type: 'edit', sceneId, scene: e.scene, added: e.added, removed: e.removed };
  try {
    await postActivity(e.pid, body, 'edit:' + sceneId, (prev) => ({ ...body, added: (prev.added ?? 0) + e.added, removed: (prev.removed ?? 0) + e.removed }));
  } catch { /* not important enough to bother anyone */ }
}
export const flushAllEdits = () => Promise.all([...edits.keys()].map(flushEdit));

/* ---------------- adding & removing things ---------------- */
const SKIP = new Set(['comment']);
const LABEL: Record<string, string> = { chapters: 'chapter', scenes: 'scene' };
const queue = new Map<string, { added: { t: string; id: string; tbl: string; label: string }[]; removed: ItemRef[]; timer: number }>();
function enqueue(pid: string, op: 'added' | 'removed', tbl: string, row: Record<string, unknown>) {
  if (!pid || !canPost(pid)) return;
  const t = tbl === 'entities' ? String(row.kind) : LABEL[tbl];
  if (!t || SKIP.has(t)) return;
  let q = queue.get(pid); if (!q) { q = { added: [], removed: [], timer: 0 }; queue.set(pid, q); }
  const id = String(row.id); const label = String(row.title ?? row.name ?? '');
  if (op === 'added') q.added.push({ t, id, tbl, label });
  else {
    const i = q.added.findIndex((a) => a.id === id);
    if (i >= 0) q.added.splice(i, 1); // made and deleted again: nothing to say
    else q.removed.push({ t, id, label });
  }
  window.clearTimeout(q.timer);
  q.timer = window.setTimeout(() => void flushItems(pid), 8000);
}
async function flushItems(pid: string) {
  const q = queue.get(pid); if (!q) return; queue.delete(pid);
  // use the name it has now (new things are usually renamed right after they're made)
  const added: ItemRef[] = [];
  for (const a of q.added) {
    const row = await (db as unknown as Record<string, { get: (id: string) => Promise<Record<string, unknown> | undefined> }>)[a.tbl].get(a.id);
    if (row) added.push({ t: a.t, id: a.id, label: String(row.title ?? row.name ?? a.label) });
  }
  if (!added.length && !q.removed.length) return;
  const body: Body = { type: 'items', items: { added, removed: q.removed } };
  try {
    await postActivity(pid, body, 'items', (prev) => ({ type: 'items', items: { added: [...(prev.items?.added ?? []), ...added].slice(-30), removed: [...(prev.items?.removed ?? []), ...q.removed].slice(-30) } }));
  } catch { /* */ }
}

let hooked = false;
export function startActivity() {
  if (hooked) return; hooked = true;
  for (const tbl of ['chapters', 'scenes', 'entities'] as const) {
    const t = db[tbl] as unknown as { hook: (ev: string, f: (...a: unknown[]) => void) => void };
    t.hook('creating', (_k, obj, tx) => { if (!isRemoteTx(tx)) { const o = obj as Record<string, unknown>; enqueue(String(o.projectId), 'added', tbl, o); } });
    t.hook('deleting', (_k, obj, tx) => { if (!isRemoteTx(tx) && obj) { const o = obj as Record<string, unknown>; enqueue(String(o.projectId), 'removed', tbl, o); } });
  }
  window.addEventListener('pagehide', () => { void flushAllEdits(); });
}
