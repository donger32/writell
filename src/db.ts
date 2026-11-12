import Dexie, { type Table } from 'dexie';
import { yearFrom } from './charDates';

/*
 * Writell data model. (The database keeps its original name, 'inkwell', so existing projects carry over.)
 *
 * Every record has a string id (crypto.randomUUID) so records can later be
 * synced to a server (Stage 4) without id collisions between devices.
 * Every record carries projectId, createdAt and updatedAt.
 *
 * Stage 1 uses: projects, chapters, scenes, snapshots, backups, sessions.
 * Stage 2+ tables (entities, links) are created now so that characters,
 * locations, events etc. can reference each other from day one.
 */

export type Status = 'idea' | 'draft' | 'revising' | 'done';

export interface Project {
  id: string;
  title: string;
  description: string;
  color: string;
  favorite: boolean;
  archived: boolean;
  goalWords: number; // 0 = no target
  coverImage?: string;      // data URL
  deadline?: string;        // yyyy-mm-dd
  checklistTemplate?: string[]; // default editing checklist for chapters
  exportOptions?: Record<string, unknown>;
  relTypes?: { id: string; label: string; color: string }[]; // custom relationship types
  /** the project's own lists of worldbuilding and note types (empty = the defaults) */
  worldTypes?: { name: string; group: string }[];
  noteTypes?: string[];
  /** tags you set up for notes before using them */
  noteTags?: string[];
  author?: string;
  /** which character fields new / un-customised characters show (layout id or a list of field keys) */
  charLayout?: string | string[];
  /** the same for worldbuilding entries */
  worldLayout?: string | string[];
  createdAt: number;
  updatedAt: number;
  openedAt: number;
}

export interface Chapter {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  notes: string;
  order: number;
  status: Status;
  color: string; // '' = none
  checklist?: { id: string; text: string; done: boolean }[];
  createdAt: number;
  updatedAt: number;
}

export interface Scene {
  id: string;
  projectId: string;
  chapterId: string;
  title: string;
  summary: string;
  notes: string;
  order: number;
  status: Status;
  /** ProseMirror JSON document (lossless canonical format) */
  /** shared projects only: the live co-writing document (merges everyone's edits) */
  ystate?: string;
  content: unknown;
  /** Cached plain stats so lists don't have to parse every document */
  words: number;
  /** Story-timeline markers */
  timeMarker?: '' | 'flashback' | 'flashforward' | 'timeskip' | 'dream';
  timeNote?: string; // e.g. "ten years earlier"
  pov?: string;      // character id
  createdAt: number;
  updatedAt: number;
}

/** Point-in-time copy of a scene, used for crash recovery & revision history */
export interface Snapshot {
  id: string;
  projectId: string;
  sceneId: string;
  content: unknown;
  words: number;
  reason: 'auto' | 'manual' | 'before-restore' | 'before-raw-edit' | 'before-sync';
  createdAt: number;
}

/** Full automatic backups of one project, rotated (newest N kept) */
export interface Backup {
  id: string;
  projectId: string;
  data: string; // JSON from exportProject()
  createdAt: number;
}

/** Writing activity, one row per project per day (used by Stage 5 statistics) */
export interface DayActivity {
  id: string; // `${projectId}:${yyyy-mm-dd}`
  projectId: string;
  day: string;
  wordsAdded: number;
  updatedAt: number;
}

/*
 * Stage 2+ generic story entities. kind = 'character' | 'location' |
 * 'organization' | 'event' | 'note' | custom worldbuilding category, etc.
 * fields holds the profile (built-in + custom fields).
 */
export interface Entity {
  id: string;
  projectId: string;
  kind: string;
  name: string;
  fields: Record<string, unknown>;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

/*
 * Typed, directional connection between ANY two records
 * (character→scene, character→character, event→location, note→chapter...).
 * Family trees, relationship diagrams and timelines are all views over links.
 */
export interface Link {
  id: string;
  projectId: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string; // e.g. 'appears-in', 'parent-of', 'rival', 'located-at'
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** Any file attached to a note (or other item) — stored inside the app */
export interface FileRec {
  id: string;
  projectId: string;
  ownerId: string;   // the entity it is attached to
  name: string;
  type: string;
  size: number;
  data: Blob;
  createdAt: number;
}

/** Something deleted, kept whole so it can be put back exactly as it was */
export interface TrashItem {
  id: string;
  projectId: string;
  projectTitle: string;
  kind: string;            // entity kind, 'chapter', 'scene' or 'project'
  name: string;
  deletedAt: number;
  rows: Partial<Record<TrashTable, unknown[]>>;
  /** family trees the item was taken off, and places that moved up a level */
  trees?: { treeId: string; memberId: string; position?: unknown }[];
  kids?: { id: string; parentId: string }[];
}
export type TrashTable = 'projects' | 'chapters' | 'scenes' | 'snapshots' | 'backups' | 'activity' | 'entities' | 'links' | 'files';

class InkwellDB extends Dexie {
  projects!: Table<Project, string>;
  chapters!: Table<Chapter, string>;
  scenes!: Table<Scene, string>;
  snapshots!: Table<Snapshot, string>;
  backups!: Table<Backup, string>;
  activity!: Table<DayActivity, string>;
  entities!: Table<Entity, string>;
  links!: Table<Link, string>;
  files!: Table<FileRec, string>;
  trash!: Table<TrashItem, string>;

  constructor() {
    super('inkwell');
    this.version(1).stores({
      projects: 'id, updatedAt, openedAt, favorite, archived',
      chapters: 'id, projectId, [projectId+order]',
      scenes: 'id, projectId, chapterId, [chapterId+order], updatedAt',
      snapshots: 'id, projectId, sceneId, [sceneId+createdAt], createdAt',
      backups: 'id, projectId, [projectId+createdAt]',
      activity: 'id, projectId, day',
      entities: 'id, projectId, [projectId+kind], name, *tags',
      links: 'id, projectId, [fromType+fromId], [toType+toId], relation',
    });
    this.version(2).stores({ files: 'id, projectId, ownerId' });
    this.version(3).stores({ trash: 'id, projectId, deletedAt' });
  }
}

export const db = new InkwellDB();

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

export const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/* ---------------- Projects ---------------- */

export async function createProject(title: string, description = ''): Promise<string> {
  const id = uid();
  const t = now();
  await db.transaction('rw', db.projects, db.chapters, db.scenes, async () => {
    await db.projects.add({
      id, title, description, color: '#8b7cf6', favorite: false, archived: false,
      goalWords: 0, createdAt: t, updatedAt: t, openedAt: t,
    });
    const chId = await addChapterRaw(id, 'Chapter 1', 0);
    await addSceneRaw(id, chId, 'Scene 1', 0);
  });
  return id;
}

export async function duplicateProject(id: string) {
  const data = await exportProject(id);
  data.project.title = data.project.title + ' (copy)';
  return importProject(data, true);
}

export const touchProject = (id: string) => db.projects.update(id, { updatedAt: now() });

/* ---------------- Chapters ---------------- */

async function addChapterRaw(projectId: string, title: string, order: number) {
  const id = uid();
  const t = now();
  await db.chapters.add({ id, projectId, title, summary: '', notes: '', order, status: 'draft', color: '', createdAt: t, updatedAt: t });
  return id;
}

async function addSceneRaw(projectId: string, chapterId: string, title: string, order: number) {
  const id = uid();
  const t = now();
  await db.scenes.add({ id, projectId, chapterId, title, summary: '', notes: '', order, status: 'draft', content: emptyDoc, words: 0, createdAt: t, updatedAt: t });
  return id;
}

export async function createChapter(projectId: string) {
  const chapters = await db.chapters.where('projectId').equals(projectId).toArray();
  const order = chapters.length ? Math.max(...chapters.map((c) => c.order)) + 1 : 0;
  let chId = '', scId = '';
  await db.transaction('rw', db.chapters, db.scenes, db.projects, async () => {
    chId = await addChapterRaw(projectId, `Chapter ${chapters.length + 1}`, order);
    scId = await addSceneRaw(projectId, chId, 'Scene 1', 0);
    await touchProject(projectId);
  });
  return { chapterId: chId, sceneId: scId };
}

export async function duplicateChapter(chapterId: string) {
  const ch = await db.chapters.get(chapterId);
  if (!ch) return;
  const scenes = await db.scenes.where('chapterId').equals(chapterId).sortBy('order');
  const siblings = await db.chapters.where('projectId').equals(ch.projectId).sortBy('order');
  const t = now();
  const newId = uid();
  await db.transaction('rw', db.chapters, db.scenes, async () => {
    // shift later chapters down by one
    for (const c of siblings) if (c.order > ch.order) await db.chapters.update(c.id, { order: c.order + 1 });
    await db.chapters.add({ ...ch, id: newId, title: ch.title + ' (copy)', order: ch.order + 1, createdAt: t, updatedAt: t });
    for (const s of scenes) await db.scenes.add({ ...s, id: uid(), chapterId: newId, createdAt: t, updatedAt: t });
  });
}

/** Persist a new ordering of chapter ids */
export async function reorderChapters(ids: string[]) {
  await db.transaction('rw', db.chapters, async () => {
    for (let i = 0; i < ids.length; i++) await db.chapters.update(ids[i], { order: i });
  });
}

/* ---------------- Scenes ---------------- */

export async function createScene(chapterId: string) {
  const ch = await db.chapters.get(chapterId);
  if (!ch) throw new Error('Chapter not found');
  const scenes = await db.scenes.where('chapterId').equals(chapterId).toArray();
  const order = scenes.length ? Math.max(...scenes.map((s) => s.order)) + 1 : 0;
  return addSceneRaw(ch.projectId, chapterId, `Scene ${scenes.length + 1}`, order);
}

/** Move a scene to (chapterId, index), renumbering both affected chapters */
export async function moveScene(sceneId: string, toChapterId: string, toIndex: number) {
  await db.transaction('rw', db.scenes, async () => {
    const scene = await db.scenes.get(sceneId);
    if (!scene) return;
    const fromChapterId = scene.chapterId;
    const target = (await db.scenes.where('chapterId').equals(toChapterId).sortBy('order')).filter((s) => s.id !== sceneId);
    target.splice(Math.max(0, Math.min(toIndex, target.length)), 0, { ...scene, chapterId: toChapterId });
    for (let i = 0; i < target.length; i++) await db.scenes.update(target[i].id, { chapterId: toChapterId, order: i });
    if (fromChapterId !== toChapterId) {
      const rest = await db.scenes.where('chapterId').equals(fromChapterId).sortBy('order');
      for (let i = 0; i < rest.length; i++) await db.scenes.update(rest[i].id, { order: i });
    }
  });
}

/* ---------------- Saving text ---------------- */

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lastSnapshotAt = new Map<string, number>();
const SNAPSHOT_EVERY = 5 * 60 * 1000;
const MAX_AUTO_SNAPSHOTS = 50;

/** `typed`: words written since the last save (deleting never counts against you) */
export async function saveSceneContent(sceneId: string, content: unknown, words: number, typed?: number, ystate?: string) {
  await db.transaction('rw', [db.scenes, db.projects, db.activity, db.snapshots], async () => {
    const scene = await db.scenes.get(sceneId);
    if (!scene) return;
    const t = now();
    await db.scenes.update(sceneId, { content, words, updatedAt: t, ...(ystate ? { ystate } : {}) });
    await db.projects.update(scene.projectId, { updatedAt: t });

    const added = typed ?? words - scene.words;
    if (added > 0) {
      const id = `${scene.projectId}:${dayKey()}`;
      const a = await db.activity.get(id);
      await db.activity.put({ id, projectId: scene.projectId, day: dayKey(), wordsAdded: (a?.wordsAdded ?? 0) + added, updatedAt: t });
    }

    // Rolling automatic snapshot (revision history + crash safety)
    const last = lastSnapshotAt.get(sceneId) ?? 0;
    if (t - last > SNAPSHOT_EVERY) {
      lastSnapshotAt.set(sceneId, t);
      // automatic copies have ids starting with "auto:", so old ones can be found without reading their text
      // (reading 50 copies of a very long scene back used to freeze typing for seconds)
      await db.snapshots.add({ id: 'auto:' + uid(), projectId: scene.projectId, sceneId, content, words, reason: 'auto', createdAt: t });
      const keys = await db.snapshots.where('[sceneId+createdAt]').between([sceneId, -Infinity], [sceneId, Infinity]).primaryKeys();
      const autos = keys.map(String).filter((k) => k.startsWith('auto:'));
      if (autos.length > MAX_AUTO_SNAPSHOTS) await db.snapshots.bulkDelete(autos.slice(0, autos.length - MAX_AUTO_SNAPSHOTS));
    }
  });
}

export async function takeSnapshot(sceneId: string, reason: Snapshot['reason']) {
  const scene = await db.scenes.get(sceneId);
  if (!scene) return;
  await db.snapshots.add({ id: uid(), projectId: scene.projectId, sceneId, content: scene.content, words: scene.words, reason, createdAt: now() });
}

/* ---------------- Export / import / backups ---------------- */

export const FORMAT = 'inkwell-project';
export const FORMAT_VERSION = 1;

export interface ProjectExport {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  project: Project;
  chapters: Chapter[];
  scenes: Scene[];
  entities: Entity[];
  links: Link[];
  activity: DayActivity[];
  files?: (Omit<FileRec, 'data'> & { data: string })[]; // base64
}

export async function exportProject(id: string, withFiles = true): Promise<ProjectExport> {
  const project = await db.projects.get(id);
  if (!project) throw new Error('Project not found');
  const files = !withFiles ? [] : await Promise.all((await db.files.where('projectId').equals(id).toArray()).map(async (f) => ({ ...f, data: await blobToBase64(f.data) })));
  const [chapters, scenes, entities, links, activity] = await Promise.all([
    db.chapters.where('projectId').equals(id).toArray(),
    db.scenes.where('projectId').equals(id).toArray(),
    db.entities.where('projectId').equals(id).toArray(),
    db.links.where('projectId').equals(id).toArray(),
    db.activity.where('projectId').equals(id).toArray(),
  ]);
  return { format: FORMAT, version: FORMAT_VERSION, exportedAt: now(), project, chapters, scenes, entities, links, activity, files };
}

/**
 * Import a project export. If asCopy (or the id already exists), every id is
 * remapped so nothing on this device is overwritten.
 */
export async function importProject(data: ProjectExport, asCopy = false): Promise<string> {
  if (data?.format !== FORMAT) throw new Error('This file is not a Writell project backup.');
  if (data.version > FORMAT_VERSION) throw new Error('This backup was made by a newer version of Writell.');
  const exists = await db.projects.get(data.project.id);
  const remap = asCopy || !!exists;
  const map = new Map<string, string>();
  const m = (id: string) => {
    if (!remap) return id;
    if (!map.has(id)) map.set(id, uid());
    return map.get(id)!;
  };
  // assign every new id up front, then rewrite references hidden inside
  // fields, link data and scene text (timeline ids, tree members, comment anchors…)
  if (remap) {
    for (const x of [data.project, ...data.chapters, ...data.scenes, ...(data.entities ?? []), ...(data.links ?? []), ...(data.files ?? [])]) m(x.id);
  }
  const deep = <T,>(v: T): T => {
    if (!remap) return v;
    if (typeof v === 'string') return (map.get(v) ?? v) as T;
    if (Array.isArray(v)) return v.map(deep) as T;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [map.get(k) ?? k, deep(x)])) as T;
    return v;
  };
  const pid = m(data.project.id);
  const t = now();
  const files = (data.files ?? []).map((f) => ({ ...f, id: m(f.id), projectId: pid, ownerId: m(f.ownerId), data: base64ToBlob(f.data, f.type) }));
  await db.transaction('rw', [db.projects, db.chapters, db.scenes, db.entities, db.links, db.activity, db.files], async () => {
    if (files.length) await db.files.bulkAdd(files);
    await db.projects.add({ ...data.project, id: pid, title: exists && !asCopy ? data.project.title + ' (restored)' : data.project.title, openedAt: t });
    await db.chapters.bulkAdd(data.chapters.map((c) => ({ ...c, id: m(c.id), projectId: pid })));
    await db.scenes.bulkAdd(data.scenes.map((s) => ({ ...s, id: m(s.id), projectId: pid, chapterId: m(s.chapterId), content: deep(s.content), pov: s.pov ? deep(s.pov) : s.pov })));
    await db.entities.bulkAdd((data.entities ?? []).map((e) => ({ ...e, id: m(e.id), projectId: pid, fields: deep(e.fields) })));
    await db.links.bulkAdd((data.links ?? []).map((l) => ({ ...l, id: m(l.id), projectId: pid, fromId: m(l.fromId), toId: m(l.toId), data: deep(l.data) })));
    await db.activity.bulkPut((data.activity ?? []).map((a) => ({ ...a, id: `${pid}:${a.day}`, projectId: pid })));
  });
  return pid;
}

const MAX_BACKUPS = 20;

/** Store a rotated, in-app automatic backup of a project */
export async function autoBackup(projectId: string) {
  // attachments stay in the project itself; in-app snapshots skip them to stay small
  const data = JSON.stringify(await exportProject(projectId, false));
  const prev = await db.backups.where('[projectId+createdAt]').between([projectId, 0], [projectId, Infinity]).last();
  if (prev && prev.data.length === data.length && prev.data === data) return; // nothing changed
  await db.backups.add({ id: uid(), projectId, data, createdAt: now() });
  const all = await db.backups.where('[projectId+createdAt]').between([projectId, 0], [projectId, Infinity]).primaryKeys();
  if (all.length > MAX_BACKUPS) await db.backups.bulkDelete(all.slice(0, all.length - MAX_BACKUPS));
}

/** Remove links whose ends no longer exist (left behind by older versions) */
export async function cleanupOrphans() {
  try {
    // v0.7.0: the separate "birth year (for timelines)" field folds into Birthday
    const withYear = await db.entities.filter((e) => e.kind === 'character' && String(e.fields.birthYear ?? '').trim() !== '').toArray();
    for (const c of withYear) {
      const by = String(c.fields.birthYear).trim();
      const bd = String(c.fields.birthday ?? '').trim();
      const birthday = !bd ? by : (yearFrom(bd) === yearFrom(by) || /\d{3,}/.test(bd)) ? bd : `${bd} ${by}`;
      const fields: Record<string, unknown> = { ...c.fields, birthday };
      delete fields.birthYear;
      await db.entities.update(c.id, { fields });
    }
    // v0.5.0 stored character lifespans as events; they now appear automatically from birth/death years
    const oldLives = await db.entities.filter((e) => e.kind === 'event' && (e.fields.subject as { type?: string } | undefined)?.type === 'character').primaryKeys();
    if (oldLives.length) await db.entities.bulkDelete(oldLives);
    const [ents, scenes, chapters] = await Promise.all([db.entities.toCollection().primaryKeys(), db.scenes.toCollection().primaryKeys(), db.chapters.toCollection().primaryKeys()]);
    const alive = new Set<string>([...ents, ...scenes, ...chapters]);
    const dead = await db.links.filter((l) => !alive.has(l.fromId) || !alive.has(l.toId)).primaryKeys();
    if (dead.length) await db.links.bulkDelete(dead);
    // timeline entries whose subject was deleted (relationship subjects are link ids)
    const linkIds = new Set(await db.links.toCollection().primaryKeys());
    const strays = await db.entities.filter((e) => { const id = (e.fields.subject as { id?: string } | undefined)?.id; return e.kind === 'event' && !!id && !alive.has(id) && !linkIds.has(id); }).primaryKeys();
    if (strays.length) await db.entities.bulkDelete(strays);
  } catch (e) { console.warn('cleanup skipped', e); }
}

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
