/*
 * Scene details without their text (title, order, status, word count…), kept in memory.
 * Lists like the sidebar, tabs and pickers used to re-read every scene, text and all, each time
 * anything saved; with a very long scene that meant copying megabytes on every keystroke pause.
 * This keeps one small copy that is updated as scenes are written, without reading the text again.
 */
import Dexie from 'dexie';
import { useSyncExternalStore } from 'react';
import { db, type Scene } from './db';

const metas = new Map<string, Scene>();
const deletedEarly = new Set<string>();
let loaded = false, loading: Promise<void> | null = null, version = 0;
const listeners = new Set<() => void>();

const strip = (s: Scene): Scene => {
  const { content: _c, ystate: _y, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, content: null } as Scene;
};
let notifyQueued = false;
const changed = () => {
  version++;
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => { notifyQueued = false; listeners.forEach((l) => l()); });
};

// follow every write to the scenes table (local edits and sync downloads both go through here)
type Tx = { on: (ev: 'complete', fn: () => void) => void };
const after = (tx: unknown, fn: () => void) => { const t = tx as Tx | undefined; if (t?.on) t.on('complete', fn); else fn(); };
db.scenes.hook('creating', function (_k, obj, tx) { const m = strip(obj as Scene); after(tx, () => { deletedEarly.delete(m.id); metas.set(m.id, m); changed(); }); });
db.scenes.hook('updating', function (mods, _k, obj, tx) {
  const next = { ...(obj as Scene) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(mods as Record<string, unknown>)) {
    if (k === 'content' || k === 'ystate') continue;
    if (v === undefined) Dexie.delByKeyPath(next, k); else Dexie.setByKeyPath(next, k, v);
  }
  const m = strip(next as unknown as Scene);
  after(tx, () => { metas.set(m.id, m); changed(); });
});
db.scenes.hook('deleting', function (k, _obj, tx) { after(tx, () => { metas.delete(String(k)); if (!loaded) deletedEarly.add(String(k)); changed(); }); });

function ensureLoaded() {
  if (loaded || loading) return;
  loading = db.scenes.each((s) => { if (!metas.has(s.id) && !deletedEarly.has(s.id)) metas.set(s.id, strip(s)); })
    .then(() => { loaded = true; deletedEarly.clear(); changed(); })
    .catch(() => { loading = null; });
}
function subscribe(fn: () => void) { ensureLoaded(); listeners.add(fn); return () => { listeners.delete(fn); }; }

// snapshots must be stable between changes, so results are cached per version
const cache = new Map<string, { v: number; val: unknown }>();
function memo<T>(key: string, make: () => T): T {
  const c = cache.get(key);
  if (c && c.v === version) return c.val as T;
  const val = make(); cache.set(key, { v: version, val }); return val;
}

/** Scene details (no text) for one project, or every project; undefined while first loading */
export function useSceneMetas(projectId?: string): Scene[] | undefined {
  return useSyncExternalStore(subscribe, () => !loaded ? undefined : memo('p:' + (projectId ?? '*'), () => [...metas.values()].filter((s) => !projectId || s.projectId === projectId)));
}
/** Details of the given scenes, in the same order (missing ones are undefined) */
export function useSceneMetasByIds(ids: string[]): (Scene | undefined)[] | undefined {
  const key = 'i:' + ids.join(',');
  return useSyncExternalStore(subscribe, () => !loaded ? undefined : memo(key, () => ids.map((id) => metas.get(id))));
}
export function useSceneMeta(id: string): Scene | undefined {
  return useSyncExternalStore(subscribe, () => metas.get(id));
}
/** for code outside React: a scene's details if they're already loaded */
export const sceneMeta = (id: string) => metas.get(id);
