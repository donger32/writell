/*
 * Trash: nothing is destroyed straight away. Every delete gathers every row it
 * removes (the item, its links, files, timeline entries, snapshots…) into one
 * TrashItem, so "Restore" can put it all back exactly as it was.
 */
import { db, uid, now, type Entity, type TrashItem, type TrashTable } from './db';

const TABLES: TrashTable[] = ['projects', 'chapters', 'scenes', 'snapshots', 'backups', 'activity', 'entities', 'links', 'files'];
const ALL = () => [db.projects, db.chapters, db.scenes, db.snapshots, db.backups, db.activity, db.entities, db.links, db.files, db.trash];

/** Kinds that are removed for good without a trip to the trash (tiny, recreated freely) */
const NO_TRASH = new Set(['comment', 'task']);

class Bag {
  rows: Partial<Record<TrashTable, unknown[]>> = {};
  trees: NonNullable<TrashItem['trees']> = [];
  kids: NonNullable<TrashItem['kids']> = [];
  add(t: TrashTable, list: unknown[]) { if (list.length) (this.rows[t] ??= []).push(...list); }
}

async function takeLinks(bag: Bag, type: string, ids: string[]) {
  if (!ids.length) return [] as string[];
  const a = await db.links.where('[fromType+fromId]').anyOf(ids.map((i) => [type, i])).toArray();
  const b = await db.links.where('[toType+toId]').anyOf(ids.map((i) => [type, i])).toArray();
  const seen = new Set<string>(); const all = [...a, ...b].filter((l) => !seen.has(l.id) && seen.add(l.id));
  bag.add('links', all);
  await db.links.bulkDelete(all.map((l) => l.id));
  return all.map((l) => l.id);
}

/** Timeline entries that stand for something ("this chapter / place / relationship on the timeline") go when it goes */
async function takeSubjectEvents(bag: Bag, ids: string[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  const evs = await db.entities.filter((e) => e.kind === 'event' && set.has(String((e.fields.subject as { id?: string } | undefined)?.id))).toArray();
  if (!evs.length) return;
  bag.add('entities', evs);
  await takeLinks(bag, 'entity', evs.map((e) => e.id));
  await db.entities.bulkDelete(evs.map((e) => e.id));
}
/** Plain delete (no trash) — kept for callers that tidy up */
export async function deleteSubjectEvents(ids: string[]) { await takeSubjectEvents(new Bag(), ids); }

async function takeComments(bag: Bag, sceneIds: string[]) {
  if (!sceneIds.length) return;
  const set = new Set(sceneIds);
  const cs = await db.entities.filter((e) => e.kind === 'comment' && set.has(String(e.fields.sceneId))).toArray();
  bag.add('entities', cs);
  await db.entities.bulkDelete(cs.map((c) => c.id));
}

async function takeEntity(bag: Bag, id: string): Promise<Entity | undefined> {
  const e = await db.entities.get(id);
  if (!e) return;
  bag.add('entities', [e]);
  const files = await db.files.where('ownerId').equals(id).toArray();
  bag.add('files', files);
  await db.files.bulkDelete(files.map((f) => f.id));
  const linkIds = await takeLinks(bag, 'entity', [id]);
  await db.entities.delete(id);
  // its own timeline entries, and those of relationships it was part of
  await takeSubjectEvents(bag, [id, ...linkIds]);
  // a timeline takes its events with it
  if (e.kind === 'timeline') {
    const evs = await db.entities.where('[projectId+kind]').equals([e.projectId, 'event']).filter((x) => x.fields.timelineId === id).toArray();
    for (const ev of evs) await takeEntity(bag, ev.id);
  }
  // take the person off any family tree they were on
  if (e.kind === 'character') {
    const trees = await db.entities.where('[projectId+kind]').equals([e.projectId, 'familytree']).toArray();
    for (const t of trees) {
      const members = (t.fields.members as string[] | undefined) ?? [];
      if (!members.includes(id)) continue;
      const positions = { ...(t.fields.positions as Record<string, unknown>) };
      bag.trees.push({ treeId: t.id, memberId: id, position: positions[id] });
      delete positions[id];
      await db.entities.update(t.id, { fields: { ...t.fields, members: members.filter((m) => m !== id), positions } });
    }
  }
  // places inside a deleted place move up one level
  const kids = await db.entities.where('[projectId+kind]').equals([e.projectId, e.kind]).filter((x) => x.fields.parentId === id).toArray();
  for (const k of kids) {
    bag.kids.push({ id: k.id, parentId: id });
    await db.entities.update(k.id, { fields: { ...k.fields, parentId: e.fields.parentId ?? undefined } });
  }
  return e;
}

async function store(bag: Bag, projectId: string, kind: string, name: string): Promise<string> {
  const id = uid();
  const p = await db.projects.get(projectId);
  await db.trash.add({ id, projectId, projectTitle: p?.title ?? '', kind, name, deletedAt: now(), rows: bag.rows, trees: bag.trees, kids: bag.kids });
  return id;
}

/** Delete a character, place, note, map, tree, timeline, event…; returns the trash id (undefined when not trashed) */
export async function deleteEntity(id: string, opts: { trash?: boolean } = {}): Promise<string | undefined> {
  return db.transaction('rw', ALL(), async () => {
    const bag = new Bag();
    const e = await takeEntity(bag, id);
    if (!e || opts.trash === false || NO_TRASH.has(e.kind)) return undefined;
    return store(bag, e.projectId, e.kind, e.name);
  });
}

async function takeScenes(bag: Bag, sceneIds: string[]) {
  if (!sceneIds.length) return;
  const scenes = await db.scenes.bulkGet(sceneIds);
  bag.add('scenes', scenes.filter(Boolean));
  await takeLinks(bag, 'scene', sceneIds);
  await takeComments(bag, sceneIds);
  await takeSubjectEvents(bag, sceneIds);
  const snaps = await db.snapshots.where('sceneId').anyOf(sceneIds).toArray();
  bag.add('snapshots', snaps);
  await db.snapshots.bulkDelete(snaps.map((s) => s.id));
  await db.scenes.bulkDelete(sceneIds);
}

export async function deleteChapter(chapterId: string) {
  return db.transaction('rw', ALL(), async () => {
    const ch = await db.chapters.get(chapterId);
    if (!ch) return undefined;
    const bag = new Bag();
    bag.add('chapters', [ch]);
    await takeScenes(bag, await db.scenes.where('chapterId').equals(chapterId).primaryKeys());
    await takeLinks(bag, 'chapter', [chapterId]);
    await takeSubjectEvents(bag, [chapterId]);
    await db.chapters.delete(chapterId);
    return store(bag, ch.projectId, 'chapter', ch.title || 'Untitled chapter');
  });
}

export async function deleteScene(sceneId: string) {
  return db.transaction('rw', ALL(), async () => {
    const sc = await db.scenes.get(sceneId);
    if (!sc) return undefined;
    const bag = new Bag();
    await takeScenes(bag, [sceneId]);
    return store(bag, sc.projectId, 'scene', sc.title || 'Untitled scene');
  });
}

export async function deleteProject(id: string) {
  return db.transaction('rw', ALL(), async () => {
    const p = await db.projects.get(id);
    if (!p) return undefined;
    const bag = new Bag();
    bag.add('projects', [p]);
    for (const t of TABLES.filter((t) => t !== 'projects')) {
      const table = db[t] as unknown as import('dexie').Table<{ id: string; projectId: string }, string>;
      const rows = await table.where('projectId').equals(id).toArray();
      bag.add(t, rows);
      await table.bulkDelete(rows.map((r) => r.id));
    }
    await db.projects.delete(id);
    return store(bag, id, 'project', p.title);
  });
}

/** Put a trashed item back. Returns a message when it could not be restored. */
export async function restoreTrash(trashId: string): Promise<{ ok: true; item: TrashItem } | { ok: false; reason: string }> {
  return db.transaction('rw', ALL(), async () => {
    const item = await db.trash.get(trashId);
    if (!item) return { ok: false as const, reason: 'Already restored or removed.' };
    if (item.kind !== 'project' && !(await db.projects.get(item.projectId))) {
      return { ok: false as const, reason: `Its project “${item.projectTitle}” is in the trash too — restore the project first.` };
    }
    const rows = structuredClone(item.rows);
    // a scene whose chapter is gone joins the first chapter (or a new one)
    if (item.kind === 'scene') {
      for (const s of (rows.scenes ?? []) as { chapterId: string; order: number }[]) {
        if (await db.chapters.get(s.chapterId)) continue;
        const first = (await db.chapters.where('projectId').equals(item.projectId).sortBy('order'))[0];
        if (first) { s.chapterId = first.id; s.order = 1e6; }
        else {
          const cid = uid(); const t = now();
          await db.chapters.add({ id: cid, projectId: item.projectId, title: 'Restored', summary: '', notes: '', order: 0, status: 'draft', color: '', createdAt: t, updatedAt: t });
          s.chapterId = cid;
        }
      }
    }
    for (const t of TABLES) {
      const list = rows[t];
      if (list?.length) await (db[t] as unknown as import('dexie').Table<unknown, string>).bulkPut(list);
    }
    if (item.kind !== 'project') {
      // drop links whose other end no longer exists
      const links = (rows.links ?? []) as { id: string; fromType: string; fromId: string; toType: string; toId: string }[];
      const exists = async (type: string, id: string) => !!(type === 'scene' ? await db.scenes.get(id) : type === 'chapter' ? await db.chapters.get(id) : await db.entities.get(id));
      for (const l of links) if (!(await exists(l.fromType, l.fromId)) || !(await exists(l.toType, l.toId))) await db.links.delete(l.id);
      // timeline entries whose timeline was deleted go onto the main one
      const tls = await db.entities.where('[projectId+kind]').equals([item.projectId, 'timeline']).sortBy('createdAt');
      for (const ev of (rows.entities ?? []) as Entity[]) {
        if (ev.kind === 'event' && tls.length && !tls.some((t) => t.id === ev.fields.timelineId)) await db.entities.update(ev.id, { fields: { ...ev.fields, timelineId: tls[0].id } });
      }
    }
    for (const tr of item.trees ?? []) {
      const t = await db.entities.get(tr.treeId);
      if (!t) continue;
      const members = (t.fields.members as string[] | undefined) ?? [];
      if (members.includes(tr.memberId)) continue;
      await db.entities.update(t.id, { fields: { ...t.fields, members: [...members, tr.memberId], positions: { ...(t.fields.positions as Record<string, unknown>), ...(tr.position ? { [tr.memberId]: tr.position } : {}) } } });
    }
    for (const k of item.kids ?? []) {
      const e = await db.entities.get(k.id);
      if (e) await db.entities.update(k.id, { fields: { ...e.fields, parentId: k.parentId } });
    }
    await db.trash.delete(trashId);
    return { ok: true as const, item };
  });
}

export const deleteForever = (trashId: string) => db.trash.delete(trashId);
export const emptyTrash = () => db.trash.clear();
