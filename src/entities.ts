import { db, uid, now, type Entity, type Link, type Project } from './db';
import { deleteSubjectEvents } from './trash';

/*
 * Stage 2 story objects, all stored in the generic `entities` table and
 * connected through `links`. Adding a new kind = add a config here.
 */

export type Kind = 'character' | 'world' | 'note' | 'event' | 'timeline' | 'familytree' | 'relmap' | 'comment' | 'map' | 'task' | 'term';

export interface FieldDef { key: string; label: string; long?: boolean; placeholder?: string }
export interface SectionDef { title: string; fields: FieldDef[] }

const f = (key: string, label: string, long = true, placeholder?: string): FieldDef => ({ key, label, long, placeholder });

export const CHARACTER_STATUS = ['Alive', 'Dead', 'Missing', 'Unknown'] as const;
export const CHARACTER_ROLES = ['Protagonist', 'Antagonist', 'Main', 'Supporting', 'Minor', 'Mentioned'] as const;

export const CHARACTER_SECTIONS: SectionDef[] = [
  { title: 'Basics', fields: [f('nicknames', 'Nicknames / aliases', false), f('age', 'Age', false), f('birthday', 'Birthday', false, 'e.g. 23/12/1324 — its year puts them on timelines'), f('deathYear', 'Death year', false), f('gender', 'Gender', false), f('occupation', 'Occupation', false)] },
  { title: 'Appearance', fields: [f('appearance', 'Physical appearance', true, 'Height, build, hair, eyes, clothing, distinguishing marks…')] },
  { title: 'Personality', fields: [f('personality', 'Personality'), f('likes', 'Likes'), f('dislikes', 'Dislikes'), f('strengths', 'Strengths'), f('weaknesses', 'Weaknesses'), f('fears', 'Fears')] },
  { title: 'Drive', fields: [f('motivations', 'Motivations'), f('goals', 'Goals'), f('ambitions', 'Ambitions')] },
  { title: 'History', fields: [f('backstory', 'Backstory'), f('memories', 'Important memories'), f('secrets', 'Secrets')] },
  { title: 'Voice & arc', fields: [f('development', 'Character development / arc'), f('dialogue', 'Dialogue examples', true, 'How do they talk? Phrases they always use…'), f('quotes', 'Important quotes')] },
  { title: 'Notes', fields: [f('notes', 'Notes')] },
];

/** Ready-made sets of character fields; a character can also have its own hand-picked list */
export const CHARACTER_LAYOUTS: { id: string; name: string; desc: string; keys: string[] }[] = [
  { id: 'full', name: 'Full profile', desc: 'Every field: looks, personality, drive, history, voice', keys: CHARACTER_SECTIONS.flatMap((s) => s.fields.map((f) => f.key)) },
  { id: 'essentials', name: 'Essentials', desc: 'What most stories need', keys: ['nicknames', 'birthday', 'deathYear', 'occupation', 'appearance', 'personality', 'goals', 'backstory', 'notes'] },
  { id: 'basics', name: 'Just the basics', desc: 'Dates, a look and some notes', keys: ['nicknames', 'birthday', 'deathYear', 'appearance', 'notes'] },
  { id: 'blank', name: 'Blank', desc: 'Nothing until you add it', keys: [] },
];
export type LayoutChoice = string | string[];
export const layoutKeys = (l: LayoutChoice | undefined) => Array.isArray(l) ? l : (CHARACTER_LAYOUTS.find((x) => x.id === l) ?? CHARACTER_LAYOUTS[0]).keys;
export const layoutName = (l: LayoutChoice | undefined) => Array.isArray(l) ? 'Custom' : (CHARACTER_LAYOUTS.find((x) => x.id === l) ?? CHARACTER_LAYOUTS[0]).name;

/** Worldbuilding categories; locations get extra geography fields */
export const WORLD_CATEGORIES: { name: string; group: 'Places' | 'Groups' | 'Beliefs & culture' | 'Systems' | 'Things & beings' | 'History & language' }[] = [
  { name: 'Country', group: 'Places' }, { name: 'Region', group: 'Places' }, { name: 'City', group: 'Places' }, { name: 'Location', group: 'Places' }, { name: 'Building', group: 'Places' },
  { name: 'Organization', group: 'Groups' }, { name: 'Faction', group: 'Groups' },
  { name: 'Religion', group: 'Beliefs & culture' }, { name: 'Belief system', group: 'Beliefs & culture' }, { name: 'Culture', group: 'Beliefs & culture' }, { name: 'Tradition', group: 'Beliefs & culture' },
  { name: 'Political system', group: 'Systems' }, { name: 'Magic system', group: 'Systems' }, { name: 'Power system', group: 'Systems' }, { name: 'Technology', group: 'Systems' },
  { name: 'Species', group: 'Things & beings' }, { name: 'Creature', group: 'Things & beings' }, { name: 'Weapon', group: 'Things & beings' }, { name: 'Equipment', group: 'Things & beings' }, { name: 'Artifact', group: 'Things & beings' }, { name: 'Important object', group: 'Things & beings' },
  { name: 'Historical event', group: 'History & language' }, { name: 'Language', group: 'History & language' }, { name: 'Terminology', group: 'History & language' },
];
export const PLACE_CATEGORIES = new Set(WORLD_CATEGORIES.filter((c) => c.group === 'Places').map((c) => c.name));

export function worldSections(category: string): SectionDef[] {
  const base: SectionDef[] = [{ title: 'Description', fields: [f('description', 'Description')] }];
  if (PLACE_CATEGORIES.has(category)) {
    base.push({ title: 'Place', fields: [f('geography', 'Geography'), f('landmarks', 'Important landmarks'), f('population', 'Population', false), f('culture', 'Culture'), f('history', 'History')] });
  } else if (['Organization', 'Faction', 'Religion', 'Belief system', 'Culture', 'Political system'].includes(category)) {
    base.push({ title: 'Details', fields: [f('beliefs', 'Beliefs / purpose'), f('structure', 'Structure & leadership'), f('history', 'History')] });
  } else if (['Magic system', 'Power system', 'Technology'].includes(category)) {
    base.push({ title: 'Rules', fields: [f('rules', 'How it works'), f('limits', 'Limits & costs'), f('history', 'Origin / history')] });
  } else if (category === 'Language' || category === 'Terminology') {
    base.push({ title: 'Language', fields: [f('meaning', 'Meaning / usage'), f('examples', 'Examples')] });
  } else {
    base.push({ title: 'Details', fields: [f('details', 'Details'), f('history', 'History')] });
  }
  base.push({ title: 'Notes', fields: [f('notes', 'Notes')] });
  return base;
}

export const NOTE_TYPES = ['Idea', 'Plot', 'Plot thread', 'Research', 'Dialogue', 'Unused scene', 'Quote', 'Journal', 'Other'] as const;

/* each project can trim or add to these lists */
export const CUSTOM_GROUP = 'Your types';
export function worldTypesOf(p: Project | undefined, used: string[] = []) {
  if (p?.worldTypes) return p.worldTypes;
  // before the list was edited: the defaults plus any types already in use
  const extra = [...new Set(used)].filter((c) => c && !WORLD_CATEGORIES.some((w) => w.name === c)).map((name) => ({ name, group: CUSTOM_GROUP }));
  return [...WORLD_CATEGORIES, ...extra];
}
export const noteTypesOf = (p: Project | undefined) => p?.noteTypes ?? [...NOTE_TYPES];
export const setWorldTypes = (projectId: string, list: { name: string; group: string }[] | undefined) => db.projects.update(projectId, { worldTypes: list, updatedAt: now() });
export const setNoteTypes = (projectId: string, list: string[] | undefined) => db.projects.update(projectId, { noteTypes: list, updatedAt: now() });

/* ---------------- CRUD ---------------- */

export async function createEntity(projectId: string, kind: Kind, name: string, fields: Record<string, unknown> = {}) {
  const id = uid();
  if (kind === 'character') fields = { status: 'Alive', role: 'Supporting', ...fields };
  if (kind === 'world') fields = { category: 'Location', ...fields };
  const t = now();
  await db.entities.add({ id, projectId, kind, name, fields, tags: [], favorite: false, createdAt: t, updatedAt: t });
  await db.projects.update(projectId, { updatedAt: t });
  return id;
}

export async function updateEntity(id: string, patch: Partial<Pick<Entity, 'name' | 'tags' | 'favorite'>> & { fields?: Record<string, unknown> }) {
  const e = await db.entities.get(id);
  if (!e) return;
  const t = now();
  await db.entities.update(id, { ...patch, fields: patch.fields ? { ...e.fields, ...patch.fields } : e.fields, updatedAt: t });
  await db.projects.update(e.projectId, { updatedAt: t });
}

export { deleteEntity } from './trash';

export async function duplicateEntity(id: string) {
  const e = await db.entities.get(id);
  if (!e) return;
  return createEntity(e.projectId, e.kind as Kind, e.name + ' (copy)', structuredClone(e.fields));
}

/* ---------------- Links ----------------
 * fromType/toType: 'entity' | 'scene' | 'chapter'
 * relation: 'appears-in' (character→scene), 'set-in' (scene→place),
 *           'about' (note→anything), 'related' (entity↔entity, data.label)
 */

export type RefType = 'entity' | 'scene' | 'chapter';

export async function addLink(projectId: string, fromType: RefType, fromId: string, toType: RefType, toId: string, relation: string, data: Record<string, unknown> = {}) {
  const exists = await db.links.where('[fromType+fromId]').equals([fromType, fromId]).filter((l) => l.toId === toId && l.relation === relation).first();
  if (exists) return exists.id;
  const id = uid();
  const t = now();
  await db.links.add({ id, projectId, fromType, fromId, toType, toId, relation, data, createdAt: t, updatedAt: t });
  return id;
}
export const removeLink = (id: string) => db.transaction('rw', [db.links, db.entities], async () => { await db.links.delete(id); await deleteSubjectEvents([id]); });
export const updateLinkData = async (id: string, data: Record<string, unknown>) => {
  const l = await db.links.get(id);
  if (l) await db.links.update(id, { data: { ...l.data, ...data }, updatedAt: now() });
};

export async function linksFrom(type: RefType, id: string, relation?: string): Promise<Link[]> {
  const all = await db.links.where('[fromType+fromId]').equals([type, id]).toArray();
  return relation ? all.filter((l) => l.relation === relation) : all;
}
export async function linksTo(type: RefType, id: string, relation?: string): Promise<Link[]> {
  const all = await db.links.where('[toType+toId]').equals([type, id]).toArray();
  return relation ? all.filter((l) => l.relation === relation) : all;
}

export async function deleteLinksFor(type: RefType, ids: string[]) {
  if (!ids.length) return;
  await db.links.where('[fromType+fromId]').anyOf(ids.map((i) => [type, i])).delete();
  await db.links.where('[toType+toId]').anyOf(ids.map((i) => [type, i])).delete();
}

/* ---------------- Images ---------------- */

/** Let the user pick an image; returns a downscaled JPEG/PNG data URL */
export function pickImage(max = 640): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86));
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    };
    input.click();
  });
}

/** Colours people can pick for a character (and that unpicked ones get automatically) */
export const NAME_COLORS = ['#e06c75', '#e8925a', '#d6b24a', '#8fb35a', '#4fbf8f', '#4fb3bf', '#5fa8f5', '#8b7cf6', '#c678dd', '#e58fb6'];
/** A steady colour from a name, so the same name always gets the same colour */
export function autoColor(name: string) {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}
/** The colour shown for a character: the one chosen on its page, or the automatic one */
export const colorOf = (e: { name: string; fields: Record<string, unknown> }) => (e.fields.color as string) || autoColor(e.name);

export const initials = (name: string) => {
  const w = name.split(/\s+/).filter(Boolean);
  // "Char 12" → "C12", "Place 3" → "P3": numbers are more telling than their first digit
  if (w.length >= 2 && /^\d{1,2}$/.test(w[1])) return ([...w[0]][0].toUpperCase() + w[1]);
  return w.slice(0, 2).map((x) => [...x][0]?.toUpperCase()).join('') || '?';
};

/**
 * Relationship labels are directional: "older brother" seen from Mara is
 * "younger sister" seen from Tomas. `label` is how the link's *from* side
 * describes the other; `reverseLabel` is how the *to* side does.
 */
export function sideLabel(l: Link, viewerId: string): string {
  return String((l.fromId === viewerId ? l.data.label : l.data.reverseLabel) ?? '');
}
export function sideKey(l: Link, viewerId: string): 'label' | 'reverseLabel' {
  return l.fromId === viewerId ? 'label' : 'reverseLabel';
}

/* ---------------- Places inside places ---------------- */

export const parentOf = (e: Entity) => (e.fields.parentId as string | undefined) || undefined;

/** Chain of parents, nearest first */
export function ancestors(e: Entity, byId: Map<string, Entity>): Entity[] {
  const out: Entity[] = [];
  let cur = parentOf(e);
  while (cur && byId.has(cur) && !out.some((x) => x.id === cur)) { const p = byId.get(cur)!; out.push(p); cur = parentOf(p); }
  return out;
}

/** True if `id` is `e` itself or somewhere inside it */
export function isInside(id: string, e: Entity, all: Entity[]): boolean {
  if (id === e.id) return true;
  const byId = new Map(all.map((x) => [x.id, x]));
  const x = byId.get(id);
  return !!x && ancestors(x, byId).some((a) => a.id === e.id);
}

export async function setParent(id: string, parentId: string | undefined) {
  const e = await db.entities.get(id);
  if (!e) return;
  if (parentId) {
    const all = await db.entities.where('[projectId+kind]').equals([e.projectId, e.kind]).toArray();
    if (isInside(parentId, e, all)) throw new Error("A place can't be inside itself or one of its own parts.");
  }
  await updateEntity(id, { fields: { parentId } });
}

/** Sensible category for a new place created inside another */
export function childCategory(parentCat: string) {
  return ({ Country: 'Region', Region: 'City', City: 'Location', Location: 'Building', Building: 'Location' } as Record<string, string>)[parentCat] ?? 'Location';
}
