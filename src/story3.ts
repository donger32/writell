import { db, type Entity, type Link } from './db';
import { addLink, createEntity, updateEntity } from './entities';

/* =====================================================================
 * Fictional calendars & dates
 * ===================================================================== */

export interface Month { name: string; days: number }
export interface Calendar { months: Month[]; era: string; dayNames?: string[] }
export interface FDate { y: number; m?: number; d?: number } // m, d are 1-based

export const GREGORIAN: Calendar = {
  era: '',
  months: [['January', 31], ['February', 28], ['March', 31], ['April', 30], ['May', 31], ['June', 30], ['July', 31], ['August', 31], ['September', 30], ['October', 31], ['November', 30], ['December', 31]].map(([name, days]) => ({ name: name as string, days: days as number })),
};

export const daysInYear = (c: Calendar) => c.months.reduce((a, m) => a + m.days, 0) || 365;

/** Continuous position of a date measured in years (for drawing & sorting) */
export function dateValue(d: FDate | undefined, c: Calendar): number {
  if (!d) return NaN;
  let doy = 0;
  const m = Math.max(1, Math.min(d.m ?? 1, c.months.length));
  for (let i = 0; i < m - 1; i++) doy += c.months[i].days;
  doy += (d.d ?? 1) - 1;
  if (!d.m) doy = 0;
  return d.y + doy / daysInYear(c);
}

export function valueToDate(v: number, c: Calendar, precision: 'year' | 'month' | 'day'): FDate {
  const y = Math.floor(v);
  if (precision === 'year') return { y };
  let doy = Math.round((v - y) * daysInYear(c));
  let m = 0;
  while (m < c.months.length - 1 && doy >= c.months[m].days) { doy -= c.months[m].days; m++; }
  return precision === 'month' ? { y, m: m + 1 } : { y, m: m + 1, d: Math.min(doy + 1, c.months[m].days) };
}

/** 1350 → "1350", -500 → "500 BC" (with a fictional era: "-500 AR") */
export function yearLabel(y: number, c: Calendar): string {
  const custom = c.era && !/^(AD|CE)$/i.test(c.era.trim());
  if (y < 0 && !custom) return `${-y} BC`;
  return `${y}${c.era ? ` ${c.era}` : ''}`;
}
export function fmtDate(d: FDate | undefined, c: Calendar): string {
  if (!d || !Number.isFinite(d.y)) return '';
  const mn = d.m ? c.months[d.m - 1]?.name ?? `Month ${d.m}` : '';
  const y = yearLabel(d.y, c);
  if (d.m && d.d) return `${d.d} ${mn} ${y}`;
  if (d.m) return `${mn} ${y}`;
  return y;
}

/* =====================================================================
 * Timelines & events
 *   timeline entity: kind 'timeline', fields { calendar, color, description }
 *   event entity:    kind 'event', fields { timelineId, start, end?, category,
 *                    color?, description, image?, unresolved? }
 *   links: event →(involves)→ character/world entity, event →(shown-in)→ scene
 * ===================================================================== */

export const EVENT_CATEGORIES: { name: string; color: string }[] = [
  { name: 'History', color: '#8b8d98' }, { name: 'War & conflict', color: '#e06c75' }, { name: 'Politics', color: '#5fa8f5' },
  { name: 'Personal', color: '#d17ad8' }, { name: 'Birth', color: '#5fbf8f' }, { name: 'Death', color: '#9a6b6b' },
  { name: 'Discovery', color: '#e8c547' }, { name: 'Disaster', color: '#e8925a' }, { name: 'Plot', color: '#8b7cf6' }, { name: 'Other', color: '#6b9a9a' },
];
export const categoryColor = (cat: string, override?: string) => override || EVENT_CATEGORIES.find((c) => c.name === cat)?.color || '#8b7cf6';

export async function ensureTimeline(projectId: string): Promise<Entity> {
  const existing = await db.entities.where('[projectId+kind]').equals([projectId, 'timeline']).first();
  if (existing) return existing;
  const id = await createEntity(projectId, 'timeline', 'World history', { calendar: GREGORIAN, color: '#8b7cf6' });
  return (await db.entities.get(id))!;
}

export const calendarOf = (t: Entity | undefined): Calendar => (t?.fields.calendar as Calendar) ?? GREGORIAN;

export async function createEvent(projectId: string, timelineId: string, name: string, start: FDate, extra: Record<string, unknown> = {}) {
  return createEntity(projectId, 'event', name, { timelineId, start, category: 'Plot', description: '', ...extra });
}

/* =====================================================================
 * Family trees
 *   familytree entity: fields { members: string[], positions: {id:{x,y}} }
 *   links relation 'family', data { type, note, label? }
 *   directional types: from = parent/guardian, to = child
 * ===================================================================== */

export const FAMILY_TYPES: { id: string; label: string; directional: boolean; group: 'parent' | 'partner' | 'sibling' | 'other'; dashed?: boolean }[] = [
  { id: 'parent', label: 'Parent → child', directional: true, group: 'parent' },
  { id: 'adoptive-parent', label: 'Adoptive parent → adopted child', directional: true, group: 'parent', dashed: true },
  { id: 'step-parent', label: 'Step-parent → step-child', directional: true, group: 'parent', dashed: true },
  { id: 'guardian', label: 'Guardian → ward', directional: true, group: 'parent', dashed: true },
  { id: 'spouse', label: 'Spouse', directional: false, group: 'partner' },
  { id: 'partner', label: 'Partner', directional: false, group: 'partner' },
  { id: 'former-spouse', label: 'Former spouse', directional: false, group: 'partner', dashed: true },
  { id: 'sibling', label: 'Sibling', directional: false, group: 'sibling' },
  { id: 'half-sibling', label: 'Half-sibling', directional: false, group: 'sibling', dashed: true },
  { id: 'step-sibling', label: 'Step-sibling', directional: false, group: 'sibling', dashed: true },
  { id: 'custom', label: 'Other (custom label)', directional: false, group: 'other', dashed: true },
];
export const familyType = (id: string) => FAMILY_TYPES.find((t) => t.id === id) ?? FAMILY_TYPES[FAMILY_TYPES.length - 1];

export async function addFamilyLink(projectId: string, fromId: string, toId: string, type: string, extra: Record<string, unknown> = {}) {
  const dup = (await db.links.where('projectId').equals(projectId).filter((l) => l.relation === 'family' &&
    ((l.fromId === fromId && l.toId === toId) || (!familyType(type).directional && l.fromId === toId && l.toId === fromId))).toArray());
  if (dup.length) return dup[0].id;
  return addLink(projectId, 'entity', fromId, 'entity', toId, 'family', { type, ...extra });
}

export interface Pos { x: number; y: number }
export const CARD_W = 180, CARD_H = 96, GAP_X = 50, GAP_Y = 90;

/** Generational auto-layout for a family tree */
export function layoutFamily(members: string[], links: Link[]): Record<string, Pos> {
  const set = new Set(members);
  const fam = links.filter((l) => l.relation === 'family' && set.has(l.fromId) && set.has(l.toId));
  const parentsOf = new Map<string, string[]>();
  const partners = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const l of fam) {
    const t = familyType(String(l.data.type));
    if (t.group === 'parent') push(parentsOf, l.toId, l.fromId);
    else if (t.group === 'partner') { push(partners, l.fromId, l.toId); push(partners, l.toId, l.fromId); }
  }
  const siblingsOf = new Map<string, string[]>();
  for (const l of fam) if (familyType(String(l.data.type)).group === 'sibling') { push(siblingsOf, l.fromId, l.toId); push(siblingsOf, l.toId, l.fromId); }

  // generations
  const gen = new Map<string, number>(members.map((m) => [m, 0]));
  for (let iter = 0; iter < members.length * 3 + 5; iter++) {
    let changed = false;
    for (const m of members) {
      let g = gen.get(m)!;
      for (const p of parentsOf.get(m) ?? []) g = Math.max(g, gen.get(p)! + 1);
      for (const p of partners.get(m) ?? []) g = Math.max(g, gen.get(p)!);
      for (const s of siblingsOf.get(m) ?? []) g = Math.max(g, gen.get(s)!);
      if (g !== gen.get(m) && g < members.length + 2) { gen.set(m, g); changed = true; }
    }
    if (!changed) break;
  }
  const rows = new Map<number, string[]>();
  members.forEach((m) => push(rows as unknown as Map<string, string[]>, String(gen.get(m)), m));
  const gens = [...rows.keys()].map(Number).sort((a, b) => a - b);
  const pos: Record<string, Pos> = {};
  const W = CARD_W + GAP_X;

  for (const g of gens) {
    const row = (rows as unknown as Map<string, string[]>).get(String(g))!;
    const desired = (m: string) => {
      const ps = (parentsOf.get(m) ?? []).filter((p) => pos[p]);
      if (ps.length) return ps.reduce((a, p) => a + pos[p].x, 0) / ps.length;
      const sib = (siblingsOf.get(m) ?? []).find((s) => pos[s]);
      return sib ? pos[sib].x + W : Infinity;
    };
    // order: by desired x, keeping partners adjacent
    const placed = new Set<string>();
    const ordered: string[] = [];
    const sorted = [...row].sort((a, b) => (desired(a) - desired(b)) || a.localeCompare(b));
    for (const m of sorted) {
      if (placed.has(m)) continue;
      // put the partner without parents in this tree on the outside
      const ps = (partners.get(m) ?? []).filter((p) => row.includes(p) && !placed.has(p));
      const group = [m, ...ps];
      group.forEach((x) => placed.add(x));
      ordered.push(...group);
    }
    let lastX = -Infinity;
    for (const m of ordered) {
      let d = desired(m);
      if (!Number.isFinite(d)) d = lastX + W;
      const x = Math.max(d - (partners.get(m)?.some((p) => ordered.indexOf(p) > ordered.indexOf(m)) ? W / 2 : 0), lastX + W);
      pos[m] = { x: Number.isFinite(x) ? x : 0, y: g * (CARD_H + GAP_Y) };
      lastX = pos[m].x;
    }
  }
  // normalise
  const minX = Math.min(...Object.values(pos).map((p) => p.x), 0);
  for (const k in pos) pos[k].x -= minX;
  return pos;
}

/* =====================================================================
 * Relationships (character ↔ character, relation 'related')
 *   data { type, label, reverseLabel, began, history: [{id, when, type, note, eventId?}] }
 * ===================================================================== */

export const REL_TYPES: { id: string; label: string; color: string }[] = [
  { id: 'friend', label: 'Friends', color: '#5fbf8f' }, { id: 'ally', label: 'Allies', color: '#6bc4c4' },
  { id: 'romantic', label: 'Romantic', color: '#e47fb4' }, { id: 'former-partner', label: 'Former partners', color: '#b07a9a' },
  { id: 'family', label: 'Family', color: '#e8c547' }, { id: 'mentor', label: 'Mentor / student', color: '#5fa8f5' },
  { id: 'rival', label: 'Rivals', color: '#e8925a' }, { id: 'enemy', label: 'Enemies', color: '#e06c75' },
  { id: 'betrayal', label: 'Betrayal', color: '#a35d5d' }, { id: 'secret', label: 'Secret', color: '#8b7cf6' },
  { id: 'other', label: 'Other', color: '#8b8d98' },
];
export type RelTypeDef = { id: string; label: string; color: string; custom?: boolean };
/** Built-in types plus the project's own (custom ones appear before "Other") */
export const allRelTypes = (custom: RelTypeDef[] = []): RelTypeDef[] =>
  [...REL_TYPES.slice(0, -1), ...custom.map((c) => ({ ...c, custom: true })), REL_TYPES[REL_TYPES.length - 1]];
export const relType = (id: unknown, custom: RelTypeDef[] = []) => allRelTypes(custom).find((t) => t.id === id) ?? REL_TYPES[REL_TYPES.length - 1];

export interface RelHistory { id: string; when: string; type: string; note: string; eventId?: string }

/** Current relationship type = last history entry, else the base type */
export function currentRelType(l: Link): string {
  const h = (l.data.history as RelHistory[] | undefined) ?? [];
  return String(h.length ? h[h.length - 1].type : l.data.type ?? 'other');
}

export async function saveDiagramPositions(entityId: string, positions: Record<string, Pos>) {
  await updateEntity(entityId, { fields: { positions } });
}
