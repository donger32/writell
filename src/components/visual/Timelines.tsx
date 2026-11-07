import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layers, Plus, Minus, X, X as XIcon, Trash2, CalendarCog, List, GanttChart, HelpCircle, Pencil, FileText, ExternalLink, CalendarDays, User, MapPin, StickyNote, HeartHandshake, BookOpen, Map as MapIcon, MoreHorizontal, SlidersHorizontal, Filter } from 'lucide-react';
import { db, type Entity, type Link, type Scene } from '../../db';
import { addLink, colorOf, createEntity, deleteEntity, removeLink, updateEntity } from '../../entities';
import { toastTrashed } from '../TrashView';
import {
  EVENT_CATEGORIES, GREGORIAN, calendarOf, categoryColor, createEvent, dateValue, ensureTimeline, fmtDate, valueToDate, relType,
  type Calendar, type FDate, type RelHistory,
  yearLabel,
} from '../../story3';
import { go } from '../../nav';
import { Modal, confirmDialog, openMenu, promptDialog, toast, uiZoom } from '../ui';
import { Avatar, Field, ImageBox, Picker, PopButton, useProjectOptions } from '../story/common';
import { openEntity } from '../story/links';
import { birthYearOf, deathYearOf, lifespan, withYear, yearFrom } from '../../charDates';

type Opts = NonNullable<ReturnType<typeof useProjectOptions>>;
type Tab = 'world' | 'story' | 'character';

function useTimelineData(projectId: string) {
  useEffect(() => { ensureTimeline(projectId); }, [projectId]);
  return useLiveQuery(async () => {
    const [timelines, events, links] = await Promise.all([
      db.entities.where('[projectId+kind]').equals([projectId, 'timeline']).sortBy('createdAt'),
      db.entities.where('[projectId+kind]').equals([projectId, 'event']).toArray(),
      db.links.where('projectId').equals(projectId).filter((l) => l.relation === 'involves' || l.relation === 'shown-in').toArray(),
    ]);
    const relTypes = (await db.projects.get(projectId))?.relTypes ?? [];
    return { timelines, events, links, relTypes };
  }, [projectId]);
}

export function TimelinesView({ projectId, tab = 'world', timelineId, characterId, eventId }: { projectId: string; tab?: Tab; timelineId?: string; characterId?: string; eventId?: string }) {
  const data = useTimelineData(projectId);
  const opts = useProjectOptions(projectId);
  const [sel, setSel] = useState<string | null>(eventId ?? null);
  useEffect(() => { if (eventId) setSel(eventId); }, [eventId]);
  if (!data || !opts || !data.timelines.length) return null;
  const timeline = data.timelines.find((t) => t.id === timelineId) ?? data.timelines[0];
  const setTab = (t: Tab) => go({ view: 'timelines', projectId, tab: t, timelineId: timeline?.id, characterId });
  const selEvent = data.events.find((e) => e.id === sel);

  return (
    <div className="visual">
      <div className="visual-bar">
        <h2>Timeline</h2>
        <div className="seg">
          <button className={tab === 'world' ? 'on' : ''} onClick={() => setTab('world')} title="Your timelines of world events">Timelines</button>
          <button className={tab === 'story' ? 'on' : ''} onClick={() => setTab('story')} title="Scenes in the order the reader meets them">Reading order</button>
          <button className={tab === 'character' ? 'on' : ''} onClick={() => setTab('character')}>Character</button>
        </div>
      </div>
      <div className="canvas-wrap">
        <div className="tl-main">
          {tab === 'world' && timeline && <WorldTimeline projectId={projectId} timeline={timeline} data={data} opts={opts} sel={sel} setSel={setSel} />}
          {tab === 'story' && <StoryTimeline projectId={projectId} data={data} opts={opts} setSel={setSel} />}
          {tab === 'character' && <CharacterTimeline projectId={projectId} characterId={characterId} data={data} opts={opts} setSel={setSel} />}
        </div>
        {selEvent && <EventPanel key={selEvent.id} ev={selEvent} data={data} opts={opts} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}

/* ---------------- Date input ---------------- */

export function DateInput({ value, cal, onChange, allowEmpty }: { value?: FDate; cal: Calendar; onChange: (d: FDate | undefined) => void; allowEmpty?: boolean }) {
  const [y, setY] = useState(value?.y?.toString() ?? '');
  useEffect(() => setY(value?.y?.toString() ?? ''), [value?.y]);
  const commitY = (s: string) => {
    if (!s.trim()) { if (allowEmpty) onChange(undefined); return; }
    const n = parseInt(s, 10);
    if (Number.isFinite(n)) onChange({ ...(value ?? {}), y: n });
  };
  return (
    <div className="row gap-s dateinput">
      <input className="input sm" style={{ width: 80 }} placeholder="Year" value={y} onChange={(e) => setY(e.target.value)} onBlur={(e) => commitY(e.target.value)} />
      <select className="input sm" value={value?.m ?? ''} disabled={!value} onChange={(e) => value && onChange({ ...value, m: e.target.value ? +e.target.value : undefined, d: e.target.value ? value.d : undefined })}>
        <option value="">—</option>{cal.months.map((m, i) => <option key={i} value={i + 1}>{m.name}</option>)}
      </select>
      <input className="input sm" style={{ width: 52 }} placeholder="Day" disabled={!value?.m} value={value?.d ?? ''} onChange={(e) => value && onChange({ ...value, d: e.target.value ? Math.max(1, Math.min(+e.target.value, cal.months[(value.m ?? 1) - 1]?.days ?? 31)) : undefined })} />
      {cal.era && <span className="muted small">{cal.era}</span>}
    </div>
  );
}

/* ---------------- World timeline ---------------- */

/* Anything can sit on the world timeline: plain events, or entries for a character, place, note or relationship */
export type SubjectKind = 'event' | 'character' | 'world' | 'note' | 'relationship' | 'chapter' | 'map';
const KINDS: { id: SubjectKind; label: string; one: string; color: string; icon: typeof User }[] = [
  { id: 'event', label: 'Events', one: 'Event', color: '', icon: CalendarDays },
  { id: 'character', label: 'Characters', one: 'Character', color: '#d17ad8', icon: User },
  { id: 'world', label: 'Places & world', one: 'Place or world entry', color: '#5fbf8f', icon: MapPin },
  { id: 'note', label: 'Notes', one: 'Note', color: '#e8c547', icon: StickyNote },
  { id: 'relationship', label: 'Relationships', one: 'Relationship', color: '#e47fb4', icon: HeartHandshake },
  { id: 'chapter', label: 'Chapters', one: 'Chapter', color: '#5fa8f5', icon: BookOpen },
  { id: 'map', label: 'Maps', one: 'Map', color: '#6bc4c4', icon: MapIcon },
];
/** Live name of whatever an entry is about */
function labelOf(e: Entity, opts: Opts): string {
  const sub = e.fields.subject as { type: SubjectKind; id: string } | undefined;
  if (!sub) return e.name;
  if (sub.type === 'chapter') return opts.chapters.find((c) => c.id === sub.id)?.title ?? e.name;
  if (sub.type === 'relationship') return e.name;
  return opts.byId.get(sub.id)?.name || e.name;
}
/** Characters sit on a timeline automatically from their birth (and death) year */
function lifeEntries(opts: Opts, timelineId: string, primaryId: string, timelineIds: Set<string>): Entity[] {
  return opts.entities.filter((c) => c.kind === 'character' && Number.isFinite(birthYearOf(c)) && !c.fields.hideOnTimeline && (timelineIds.has(c.fields.lifeTimelineId as string) ? c.fields.lifeTimelineId : primaryId) === timelineId)
    .map((c) => {
      const d = deathYearOf(c);
      return { ...c, id: 'life:' + c.id, kind: 'event', fields: { subject: { type: 'character', id: c.id }, timelineId, category: 'Birth', start: { y: birthYearOf(c) }, ...(Number.isFinite(d) ? { end: { y: d } } : {}) } } as Entity;
    });
}
const kindOf = (e: Entity): SubjectKind => ((e.fields.subject as { type?: SubjectKind } | undefined)?.type ?? 'event');
const kindDef = (k: SubjectKind) => KINDS.find((x) => x.id === k)!;
export const yearOf = (v: unknown) => { const m = String(v ?? '').match(/-?\d{1,6}/); return m ? parseInt(m[0], 10) : NaN; };

/** Create a timeline entry for a character, place, note or relationship */
async function addSubjectEntry(projectId: string, timelineId: string, kind: SubjectKind, id: string, opts: Opts, fallbackYear: number): Promise<string> {
  let name = '', start: FDate = { y: fallbackYear }, end: FDate | undefined, category = 'Other';
  const involve: string[] = [];
  if (kind === 'relationship') {
    const l = await db.links.get(id);
    const a = l && opts.byId.get(l.fromId), b = l && opts.byId.get(l.toId);
    name = `${a?.name ?? '?'} & ${b?.name ?? '?'}`; category = 'Personal';
    const y = yearOf(l?.data.began); if (Number.isFinite(y)) start = { y };
    if (l) involve.push(l.fromId, l.toId);
  } else if (kind === 'chapter') {
    name = opts.chapters.find((c) => c.id === id)?.title ?? 'Chapter'; category = 'Plot';
  } else {
    const e = opts.byId.get(id)!;
    name = e.name || 'Untitled'; if (kind !== 'map') involve.push(id);
    if (kind === 'character') {
      category = 'Birth';
      const b = birthYearOf(e), d = deathYearOf(e);
      if (Number.isFinite(b)) start = { y: b };
      if (Number.isFinite(d)) end = { y: d }; else if (Number.isFinite(b) && e.fields.status === 'Dead') end = undefined;
    } else if (kind === 'world') category = 'History';
    else if (kind === 'note') category = 'Plot';
  }
  const evId = await createEvent(projectId, timelineId, name, start, { subject: { type: kind, id }, category, ...(end ? { end } : {}) });
  for (const t of involve) await addLink(projectId, 'entity', evId, 'entity', t, 'involves');
  return evId;
}

const ZOOMS = [{ id: 'millennia', label: 'Millennia', px: 0.12 }, { id: 'centuries', label: 'Centuries', px: 1.1 }, { id: 'decades', label: 'Decades', px: 9 }, { id: 'years', label: 'Years', px: 70 }, { id: 'months', label: 'Months', px: 700 }, { id: 'days', label: 'Days', px: 9000 }];
const MIN_PX = 0.02, MAX_PX = 20000;
/** every timeline covers at least this much, so you can scroll anywhere without making room first */
const FULL_FROM = -30000, FULL_TO = 30000;
/** the scrolling area is never wider than this; when zoomed in far, it follows you as you scroll */
const MAX_W = 6_000_000;
type Density = 'cards' | 'compact' | 'fit';
const DENSITY_KEY = 'inkwell.timelineDensity';
const labelWidth = (t: string) => Math.min(260, t.length * 6.6 + 34);
const CARD = 168;

function WorldTimeline({ projectId, timeline, data, opts, sel, setSel }: { projectId: string; timeline: Entity; data: NonNullable<ReturnType<typeof useTimelineData>>; opts: Opts; sel: string | null; setSel: (id: string | null) => void }) {
  const cal = calendarOf(timeline);
  const [pxUser, setPx] = useState<number | null>(null);
  const [boxW, setBoxW] = useState(900);
  const [boxH, setBoxH] = useState(500);
  const [density, setDensityState] = useState<Density>(() => { try { return (localStorage.getItem(DENSITY_KEY) as Density) || 'fit'; } catch { return 'fit'; } });
  const setDensity = (d: Density) => { setDensityState(d); try { localStorage.setItem(DENSITY_KEY, d); } catch { /* */ } };
  const [mode, setMode] = useState<'chart' | 'list'>('chart');
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [who, setWho] = useState('');
  const [where, setWhere] = useState('');
  const [calOpen, setCalOpen] = useState(false);
  const [hiddenKinds, setHiddenKinds] = useState<Set<SubjectKind>>(new Set());
  const [grouped, setGrouped] = useState(true);
  const [adding, setAdding] = useState<SubjectKind | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const ro = new ResizeObserver(() => { setBoxW(el.clientWidth); setBoxH(el.clientHeight); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const [drag, setDrag] = useState<{ id: string; x0: number; v0: number; dx: number } | null>(null);
  // what's in the middle of the screen: `winCenter` places the scrolling area when zoomed in far,
  // `viewC` (updated while scrolling) decides which ruler marks to draw, `anchor` re-centers after zooming
  const [winCenter, setWinCenter] = useState<number | null>(null);
  const [viewC, setViewC] = useState<number | null>(null);
  const anchor = useRef<number | 'fit' | null>('fit');
  const scrollRaf = useRef(0);

  const involves = (evId: string, entId: string) => data.links.some((l) => l.relation === 'involves' && l.fromId === evId && l.toId === entId);
  const lives = lifeEntries(opts, timeline.id, data.timelines[0].id, new Set(data.timelines.map((t) => t.id))).filter((e) => !who || e.id === 'life:' + who).filter(() => !where);
  // eras ("The Long Winter, 1200–1350") are shaded bands behind everything, not rows
  const eras = data.events.filter((e) => e.fields.timelineId === timeline.id && e.fields.era)
    .map((e) => ({ e, v: dateValue(e.fields.start as FDate, cal), end: dateValue(e.fields.end as FDate | undefined, cal) }))
    .filter((x) => Number.isFinite(x.v)).sort((a, b) => a.v - b.v);
  const events = [...data.events.filter((e) => e.fields.timelineId === timeline.id && kindOf(e) !== 'character' && !e.fields.era)
    .filter((e) => !cats.size || cats.has(String(e.fields.category)))
    .filter((e) => !who || involves(e.id, who))
    .filter((e) => !where || involves(e.id, where)), ...lives]
    .filter((e) => !hiddenKinds.has(kindOf(e)))
    .map((e) => ({ e, v: dateValue(e.fields.start as FDate, cal), end: dateValue(e.fields.end as FDate | undefined, cal) }))
    .filter((x) => Number.isFinite(x.v))
    .sort((a, b) => a.v - b.v);
  const undated = data.events.filter((e) => e.fields.timelineId === timeline.id && !Number.isFinite(dateValue(e.fields.start as FDate, cal)));

  const spanned = [...events, ...eras];
  const evMin = spanned.length ? Math.floor(Math.min(...spanned.map((x) => x.v))) - 1 : new Date().getFullYear() - 5;
  const evMax = spanned.length ? Math.ceil(Math.max(...spanned.map((x) => (Number.isFinite(x.end) ? x.end : x.v)))) + 1 : evMin + 10;
  const fitC = (evMin + evMax) / 2;
  const PAD = 80;
  // "Fit": everything that's on the timeline in view
  const fitPx = Math.max(MIN_PX, Math.min(9000, (boxW - 2 * PAD - (density === 'cards' ? CARD : 120)) / Math.max(1, evMax - evMin)));
  const px = pxUser ?? fitPx;
  // the whole range (30000 BC – 30000, or more if things are further out), or a big slice of it around where you are
  const fullMin = Math.min(FULL_FROM, evMin - 10), fullMax = Math.max(FULL_TO, evMax + 10);
  let vmin = fullMin, vmax = fullMax;
  if ((fullMax - fullMin) * px > MAX_W) {
    const span = MAX_W / px;
    vmin = Math.min(Math.max((winCenter ?? fitC) - span / 2, fullMin), fullMax - span);
    vmax = vmin + span;
  }
  const X = (v: number) => PAD + (v - vmin) * px;
  const width = X(vmax) + PAD;
  const centerNow = () => { const el = scroller.current; return el ? vmin + (el.scrollLeft + el.clientWidth / 2 - PAD) / px : viewC ?? fitC; };
  // when "Fit" is on and the size changes, keep everything in view
  const lastFit = useRef(fitPx);
  if (pxUser === null && Math.abs(lastFit.current - fitPx) > 1e-9) { lastFit.current = fitPx; anchor.current = 'fit'; }
  useLayoutEffect(() => {
    const el = scroller.current; const a = anchor.current;
    if (!el || a === null) return;
    anchor.current = null;
    const c = a === 'fit' ? fitC : a;
    el.scrollLeft = Math.max(0, X(c) - el.clientWidth / 2);
    setViewC(c);
  });
  const onScroll = () => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      const el = scroller.current; if (!el) return;
      const c = centerNow();
      setViewC(c);
      // zoomed in far: move the scrolling area along before you reach its end
      const windowed = (fullMax - fullMin) * px > MAX_W;
      if (windowed && (el.scrollLeft < el.clientWidth || el.scrollLeft > width - 2 * el.clientWidth)) { setWinCenter(c); anchor.current = c; }
    });
  };
  const precision = px < 120 ? 'year' : px < 3000 ? 'month' : 'day';

  // lanes so cards don't overlap (optionally one band per kind: events, characters, places…)
  const GROUP_GAP = density === 'cards' ? 26 : 20;
  const whenOf = (e: Entity) => `${fmtDate(e.fields.start as FDate, cal)}${e.fields.end ? ` – ${fmtDate(e.fields.end as FDate, cal)}` : ''}`;
  // compact rows show the date beside the name; "show all" keeps just the name (date in the tooltip)
  const labelText = (e: Entity) => labelOf(e, opts) + (density === 'compact' ? '  ' + whenOf(e) : '');
  const pack = (withLabels: boolean) => {
    const itemRight = (x: { e: Entity; v: number; end: number }, left: number) => density === 'cards'
      ? Math.max(left + CARD, Number.isFinite(x.end) ? X(x.end) : 0)
      : Math.max(left + (withLabels ? labelWidth(labelText(x.e)) : 12), Number.isFinite(x.end) ? X(x.end) + 6 : 0);
    const groups: { kind: SubjectKind | 'all'; firstLane: number; lanes: number; index: number }[] = [];
    const placed: (typeof events[number] & { left: number; right: number; lane: number; group: number })[] = [];
    const order: (SubjectKind | 'all')[] = grouped ? KINDS.map((k) => k.id).filter((k) => events.some((x) => kindOf(x.e) === k)) : ['all'];
    let laneBase = 0;
    order.forEach((g, gi) => {
      const lanes: number[] = [];
      for (const x of events.filter((x) => g === 'all' || kindOf(x.e) === g)) {
        const left = X(x.v);
        const right = itemRight(x, left);
        let lane = lanes.findIndex((r) => r < left - (density === 'cards' ? 8 : 4));
        if (lane < 0) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = right;
        placed.push({ ...x, left, right, lane: laneBase + lane, group: gi });
      }
      groups.push({ kind: g, firstLane: laneBase, lanes: Math.max(1, lanes.length), index: gi });
      laneBase += Math.max(1, lanes.length);
    });
    return { groups, placed, totalLanes: laneBase };
  };
  const GAPS = (n: number) => (grouped ? n * GROUP_GAP : 0);
  const avail = (n: number) => boxH - 52 - (eras.length ? 22 : 0) - GAPS(n);
  let packed = pack(true);
  // "show all": when the names no longer fit side by side, drop them (hover shows them) so every item stays on screen
  let labelsHidden = false;
  if (density === 'fit' && packed.totalLanes * 12 > avail(packed.groups.length)) {
    const bare = pack(false);
    if (bare.totalLanes < packed.totalLanes) { packed = bare; labelsHidden = true; }
  }
  const { groups, placed, totalLanes } = packed;
  // row height: big cards, compact rows, or squeezed so everything fits on screen at once
  const ROW = density === 'cards' ? 74 : density === 'compact' ? 28 : Math.max(labelsHidden ? 6 : 12, Math.min(28, Math.floor(avail(groups.length) / Math.max(1, totalLanes))));
  const ERA_H = eras.length ? 22 : 0;
  const topOf = (lane: number, group: number) => 40 + ERA_H + lane * ROW + (grouped ? (group + 1) * GROUP_GAP : 0);

  // ruler marks, only around what's on screen, spaced so the labels never run into each other
  const ticks: { x: number; label: string; major: boolean }[] = [];
  const seen = viewC ?? fitC;
  const half = (1.5 * boxW) / px;
  const t0 = Math.max(vmin, seen - half), t1 = Math.min(vmax, seen + half);
  const nMonths = Math.max(1, cal.months.length);
  const monthPx = px / nMonths;
  const mStep = [1, 2, 3, 4, 6].find((k) => k * monthPx >= 58 && nMonths % k === 0);
  if (!mStep) {
    // years: 1, 2, 5, 10, 20, 50, 100 … so labels stay ~80px apart
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    const step = steps.find((st) => st * px >= 80) ?? 100000;
    for (let y = Math.ceil(t0 / step) * step; y <= t1; y += step) ticks.push({ x: X(y), label: yearLabel(y, { ...cal, era: '' }), major: y % (step * 5) === 0 });
  } else {
    const daysPerYear = cal.months.reduce((a, m) => a + m.days, 0) || 365;
    const dayStep = [1, 2, 5, 10].find((k) => (k * px) / daysPerYear >= 34);
    for (let y = Math.floor(t0); y <= Math.ceil(t1); y++) cal.months.forEach((m, i) => {
      const v = dateValue({ y, m: i + 1 }, cal);
      if (v >= t0 && v <= t1 && i % mStep === 0) ticks.push({ x: X(v), label: i === 0 || monthPx >= 120 ? `${m.name.slice(0, 3)} ${yearLabel(y, { ...cal, era: '' })}` : m.name.slice(0, 3), major: i === 0 });
      if (dayStep && mStep === 1) for (let d = 1 + dayStep; d <= m.days; d += dayStep) { const dv = dateValue({ y, m: i + 1, d }, cal); if (dv >= t0 && dv <= t1) ticks.push({ x: X(dv), label: `${d}`, major: false }); }
    });
  }

  const addEvent = async (at?: FDate) => {
    const name = await promptDialog(at ? `New event in ${fmtDate(at, cal)}` : 'New event', '', 'Add');
    if (!name) return;
    const last = events[events.length - 1];
    const id = await createEvent(projectId, timeline.id, name, at ?? { y: last ? Math.floor(last.v) + 1 : new Date().getFullYear() });
    setSel(id);
  };
  const addEra = async () => {
    const name = await promptDialog('New era', 'The Long Winter', 'Add');
    if (!name) return;
    const y0 = events.length ? Math.floor(events[0].v) : new Date().getFullYear();
    const y1 = events.length ? Math.ceil(events[events.length - 1].v) : y0 + 50;
    const id = await createEvent(projectId, timeline.id, name, { y: y0 }, { era: true, end: { y: Math.max(y1, y0 + 1) }, category: 'History', color: '#5fa8f5' });
    setSel(id);
  };
  /** double-click empty space: add an event at that date */
  const addAtPointer = (ev: React.MouseEvent) => {
    const t = ev.target as HTMLElement;
    if (t.closest('.tl-row-item, .tl-card, .tl-era-label')) return;
    const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const v = vmin + ((ev.clientX - box.left) / uiZoom() - PAD) / px;
    addEvent(valueToDate(v, cal, precision));
  };

  const newTimeline = async () => { const n = await promptDialog('New timeline', 'e.g. Main story, Second age, William\'s life', 'Create'); if (n) { const id = await createEntity(projectId, 'timeline', n, { calendar: cal }); go({ view: 'timelines', projectId, tab: 'world', timelineId: id }); } };
  const timelineActions = (ev: React.MouseEvent) => openMenu(ev, [
    { label: 'Rename…', icon: <Pencil size={14} />, onClick: async () => { const n = await promptDialog('Rename timeline', timeline.name); if (n) updateEntity(timeline.id, { name: n }); } },
    { label: 'Calendar settings…', hint: 'Months, days, eras', icon: <CalendarCog size={14} />, onClick: () => setCalOpen(true) },
    ...(data.timelines.length > 1 ? [{ divider: true, label: '', onClick: () => {} }, { label: 'Delete timeline', danger: true, icon: <Trash2 size={14} />, onClick: async () => {
      if (await confirmDialog(`Delete “${timeline.name}” and its ${data.events.filter((e) => e.fields.timelineId === timeline.id).length} events?`, 'It goes to the Trash with its events; characters move back to the main timeline.', { danger: true, ok: 'Move to Trash' })) {
        go({ view: 'timelines', projectId, tab: 'world' }); toastTrashed(timeline.name, await deleteEntity(timeline.id));
      }
    } }] : []),
  ]);
  const nearestZoom = ZOOMS.reduce((best, z) => (Math.abs(Math.log(px / z.px)) < Math.abs(Math.log(px / best.px)) ? z : best), ZOOMS[0]);
  // zooming keeps what's in the middle of the screen in the middle
  const zoomTo = (np: number | null) => { const c = centerNow(); setPx(np === null ? null : Math.max(MIN_PX, Math.min(MAX_PX, np))); if (np === null) { setWinCenter(null); anchor.current = 'fit'; } else { setWinCenter(c); anchor.current = c; } };
  const zoomBy = (f: number) => zoomTo(px * f);
  const filterCount = hiddenKinds.size + cats.size + (who ? 1 : 0) + (where ? 1 : 0);
  const clearFilters = () => { setHiddenKinds(new Set()); setCats(new Set()); setWho(''); setWhere(''); };

  return (
    <div className="tl">
      <div className="tl-tabs" role="tablist" aria-label="Timelines">
        {data.timelines.map((t) => (
          <div key={t.id} className={'tl-tab' + (t.id === timeline.id ? ' on' : '')} role="tab" aria-selected={t.id === timeline.id}>
            <button className="tl-tab-name" onClick={() => go({ view: 'timelines', projectId, tab: 'world', timelineId: t.id })}
              onDoubleClick={async () => { if (t.id !== timeline.id) return; const n = await promptDialog('Rename timeline', t.name); if (n) updateEntity(t.id, { name: n }); }}
              onContextMenu={(e) => { e.preventDefault(); if (t.id === timeline.id) timelineActions(e); else go({ view: 'timelines', projectId, tab: 'world', timelineId: t.id }); }}>{t.name}</button>
            {t.id === timeline.id && <button className="icon-btn sm" title="Timeline options" aria-label="Timeline options" onClick={timelineActions}><MoreHorizontal size={13} /></button>}
          </div>
        ))}
        <button className="icon-btn sm tl-tab-add" title="New timeline" aria-label="New timeline" onClick={newTimeline}><Plus size={14} /></button>
      </div>
      <div className="tl-bar">
        <div className="zoom-ctl" role="group" aria-label="Zoom">
          <button className="icon-btn sm" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1 / 2.5)}><Minus size={14} /></button>
          <button className={'btn ghost sm' + (pxUser === null ? ' on-text' : '')} onClick={() => zoomTo(null)} title="Fit everything in view">Fit</button>
          <button className="icon-btn sm" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(2.5)}><Plus size={14} /></button>
        </div>
        <PopButton icon={<SlidersHorizontal size={13} />} label="View">
          <div className="pop-label">Scale</div>
          <select className="zoom-select" value={nearestZoom.id} onChange={(e) => zoomTo(ZOOMS.find((z) => z.id === e.target.value)!.px)} aria-label="Scale">
            {ZOOMS.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
          <div className="pop-label">Layout</div>
          <div className="seg" role="group" aria-label="Layout">
            <button className={density === 'fit' ? 'on' : ''} onClick={() => setDensity('fit')} title="Squeeze rows so everything is visible at once">Show all</button>
            <button className={density === 'compact' ? 'on' : ''} onClick={() => setDensity('compact')} title="One slim row per item">Compact</button>
            <button className={density === 'cards' ? 'on' : ''} onClick={() => setDensity('cards')} title="Large cards with details">Cards</button>
          </div>
          <label className="check small"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Separate rows for events, characters, places…</label>
          <div className="pop-label">Show as</div>
          <div className="seg"><button className={mode === 'chart' ? 'on' : ''} onClick={() => setMode('chart')}><GanttChart size={13} /> Timeline</button><button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}><List size={13} /> List</button></div>
        </PopButton>
        <PopButton icon={<Filter size={13} />} label="Filter" badge={filterCount || undefined} wide>
          <div className="pop-label">Show</div>
          <div className="chips">{KINDS.map((k) => (
            <button key={k.id} className={'chip' + (!hiddenKinds.has(k.id) ? ' on' : '')} onClick={() => setHiddenKinds((s) => { const n = new Set(s); if (n.has(k.id)) n.delete(k.id); else n.add(k.id); return n; })}><k.icon size={11} /> {k.label}</button>
          ))}</div>
          <div className="pop-label">Only these kinds of event</div>
          <div className="chips">{EVENT_CATEGORIES.map((c) => <button key={c.name} className={'chip' + (cats.has(c.name) ? ' on' : '')} onClick={() => setCats((s) => { const n = new Set(s); if (n.has(c.name)) n.delete(c.name); else n.add(c.name); return n; })}><span className="dot" style={{ background: c.color }} /> {c.name}</button>)}</div>
          <div className="pop-label">Involving</div>
          <div className="row gap-s wrap">
            <select className="pill-select" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Any character</option>{opts.characterOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
            <select className="pill-select" value={where} onChange={(e) => setWhere(e.target.value)}><option value="">Any place</option>{opts.placeOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          </div>
          {filterCount > 0 && <button className="btn ghost sm" onClick={clearFilters}><XIcon size={13} /> Clear filters</button>}
        </PopButton>
        {filterCount > 0 && <button className="chip on filter-on" onClick={clearFilters} title="Clear filters">Filtered <XIcon size={11} /></button>}
        <span className="grow" />
        <button className="btn primary sm" onClick={(ev) => openMenu(ev, [
          { label: 'Event…', hint: 'or double-click the timeline', icon: <CalendarDays size={14} />, onClick: () => addEvent() },
          { label: 'Era…', hint: 'a named stretch of time', icon: <Layers size={14} />, onClick: addEra },
          { label: 'Place or world entry…', icon: <MapPin size={14} />, onClick: () => setAdding('world') },
          { label: 'Note…', icon: <StickyNote size={14} />, onClick: () => setAdding('note') },
          { label: 'Relationship…', icon: <HeartHandshake size={14} />, onClick: () => setAdding('relationship') },
          { label: 'Chapter…', icon: <BookOpen size={14} />, onClick: () => setAdding('chapter') },
          { label: 'Map…', icon: <MapIcon size={14} />, onClick: () => setAdding('map') },
          { divider: true, label: '', onClick: () => {} },
          { label: 'Characters appear from their birthday', hint: 'Set it on their profile', icon: <User size={14} />, onClick: () => go({ view: 'characters', projectId }) },
        ])}><Plus size={13} /> Add to timeline</button>
      </div>

      {mode === 'chart' ? (
        <div className={'tl-scroll d-' + density} ref={scroller} onScroll={onScroll} onDragStart={(e) => e.preventDefault()}
          onPointerMove={(e) => drag && setDrag({ ...drag, dx: (e.clientX - drag.x0) / uiZoom() })}
          onPointerUp={async () => {
            if (!drag) return;
            if (Math.abs(drag.dx) > 3 && drag.id.startsWith('life:')) {
              // moving a character's life bar shifts their birth (and death) year — only after asking
              // (the bar stays where it was dropped while the question is open)
              const c = opts.byId.get(drag.id.slice(5));
              const dy = Math.round(drag.dx / px);
              if (c && dy) {
                const fields = { birthday: withYear(c.fields.birthday || c.fields.birthYear, birthYearOf(c) + dy), ...(Number.isFinite(deathYearOf(c)) ? { deathYear: withYear(c.fields.deathYear, deathYearOf(c) + dy) } : {}) };
                if (await confirmLifeChange(c, fields)) await updateEntity(c.id, { fields });
              }
            } else if (Math.abs(drag.dx) > 3) {
              const ev = data.events.find((x) => x.id === drag.id)!;
              const nv = drag.v0 + drag.dx / px;
              const start = valueToDate(nv, cal, precision);
              const patch: Record<string, unknown> = { start };
              if (ev.fields.end) patch.end = valueToDate(dateValue(ev.fields.end as FDate, cal) + drag.dx / px, cal, precision);
              await updateEntity(ev.id, { fields: patch });
            }
            setDrag(null);
          }}>
          <div className={'tl-canvas d-' + density} onDoubleClick={addAtPointer} title="Double-click to add an event here" style={{ width, height: density === 'fit' ? Math.max(boxH - 2, topOf(totalLanes, groups.length - 1) + 12) : Math.max(260, topOf(totalLanes, groups.length - 1) + 60) }}>
            {ticks.map((t, i) => (
              <div key={i} className={'tl-tick' + (t.major ? ' major' : '')} style={{ left: t.x }}><span>{t.label}</span></div>
            ))}
            <div className="tl-axis" />
            {eras.map(({ e, v, end }) => {
              const c = categoryColor(String(e.fields.category), e.fields.color as string);
              const w = Math.max(8, (Number.isFinite(end) ? X(end) : X(v) + 40) - X(v));
              return (
                <div key={e.id} className={'tl-era' + (sel === e.id ? ' on' : '')} style={{ left: X(v), width: w, ['--c' as string]: c }}>
                  <button className="tl-era-label" style={{ maxWidth: w }} onClick={() => setSel(e.id)} title={`${e.name} · ${whenOf(e)}`}>{e.name}</button>
                </div>
              );
            })}
            {grouped && groups.map((g) => g.kind !== 'all' && (
              <div key={g.kind} className="tl-group" style={{ top: topOf(g.firstLane, g.index) - GROUP_GAP + 4 }}>
                {(() => { const K = kindDef(g.kind); return <span className="tl-group-label"><K.icon size={12} /> {K.label}</span>; })()}
              </div>
            ))}
            {placed.map(({ e, v, end, left, lane, group }) => {
              const kind = kindOf(e);
              const K = kindDef(kind);
              const subj = e.fields.subject as { id: string } | undefined;
              const person = kind === 'character' && subj ? opts.byId.get(subj.id) : undefined;
              // characters wear their own colour; other kinds their kind colour; events their category's
              const color = person ? colorOf(person) : (kind !== 'event' && !e.fields.color ? K.color : '') || categoryColor(String(e.fields.category), e.fields.color as string);
              const subjEnt = subj ? opts.byId.get(subj.id) : undefined;
              const top = topOf(lane, group);
              const dx = drag?.id === e.id ? drag.dx : 0;
              const chars = data.links.filter((l) => l.relation === 'involves' && l.fromId === e.id && l.toId !== (e.fields.subject as { id?: string } | undefined)?.id).map((l) => opts.byId.get(l.toId)).filter((x) => x?.kind === 'character') as Entity[];
              const click = () => { if (!drag || Math.abs(drag.dx) < 4) { if (e.id.startsWith('life:')) { const c = opts.byId.get(e.id.slice(5)); if (c) openEntity(c); } else setSel(e.id); } };
              const down = (pe: React.PointerEvent) => { if (pe.button !== 0) return; pe.preventDefault(); (pe.currentTarget as HTMLElement).setPointerCapture?.(pe.pointerId); setDrag({ id: e.id, x0: pe.clientX, v0: v, dx: 0 }); };
              const when = whenOf(e);
              if (density !== 'cards') {
                const h = ROW - 4;
                const span = Number.isFinite(end) ? Math.max(6, X(end) - left) : 0;
                return (
                  <div key={e.id} className={'tl-row-item' + (sel === e.id ? ' on' : '') + (e.fields.unresolved ? ' unresolved' : '') + (h < 16 ? ' tiny' : '')}
                    style={{ left: left + dx, top, height: h, ['--c' as string]: color }} onPointerDown={down} onClick={click}
                    title={`${labelOf(e, opts)} · ${when}${e.id.startsWith('life:') ? ' (drag to change birth year, click to open)' : ''}`}>
                    {span ? <span className="tl-span" style={{ width: span }} /> : <span className="tl-pt" />}
                    {h >= 8 && !labelsHidden && <span className="tl-item-label" style={{ maxWidth: labelWidth(labelText(e)) }}>
                      {(kind === 'character' || kind === 'world') && h >= 18 && <Avatar name={subjEnt?.name ?? e.name} color={subjEnt?.fields.color as string | undefined} image={subjEnt?.fields.image as string | undefined} size={Math.min(16, h - 4)} round={kind === 'character'} />}
                      <span className="tl-name">{labelOf(e, opts)}</span>{density === 'compact' && <span className="muted"> {when}</span>}
                    </span>}
                  </div>
                );
              }
              return (
                <div key={e.id}>
                  {Number.isFinite(end) && <div className="tl-range" style={{ left: left + dx, width: Math.max(4, X(end) - left), background: color, top: top + 56 }} />}
                  <div className={'tl-card' + (sel === e.id ? ' on' : '') + (e.fields.unresolved ? ' unresolved' : '') + (kind !== 'event' ? ' subject' : '')} style={{ left: left + dx, top, borderColor: color }}
                    onPointerDown={(pe) => { if (pe.button !== 0) return; pe.preventDefault(); (pe.currentTarget as HTMLElement).setPointerCapture?.(pe.pointerId); setDrag({ id: e.id, x0: pe.clientX, v0: v, dx: 0 }); }}
                    onClick={() => { if (!drag || Math.abs(drag.dx) < 4) { if (e.id.startsWith('life:')) { const c = opts.byId.get(e.id.slice(5)); if (c) openEntity(c); } else setSel(e.id); } }}
                    title={e.id.startsWith('life:') ? `${e.name}: drag to change birth year, click to open the profile` : undefined}>
                    <div className="tl-dot" style={{ background: color }} />
                    <div className="row gap-s" style={{ minWidth: 0 }}>
                      {kind === 'character' || kind === 'world' ? <Avatar name={subjEnt?.name ?? e.name} color={subjEnt?.fields.color as string | undefined} image={subjEnt?.fields.image as string | undefined} size={18} round={kind === 'character'} /> : kind !== 'event' ? <K.icon size={13} style={{ color, flex: 'none' }} /> : null}
                      <strong className="ellipsis">{labelOf(e, opts)}</strong>
                    </div>
                    <span className="muted small ellipsis">{kind !== 'event' && e.name && e.name !== labelOf(e, opts) ? `${e.name} · ` : ''}{fmtDate(e.fields.start as FDate, cal)}{e.fields.end ? ` – ${fmtDate(e.fields.end as FDate, cal)}` : ''}</span>
                    <div className="row tl-faces">{chars.slice(0, 5).map((c) => <Avatar key={c.id} name={c.name} color={c.fields.color as string | undefined} image={c.fields.image as string} size={16} />)}{e.fields.unresolved ? <HelpCircle size={13} className="accent" /> : null}</div>
                  </div>

                </div>
              );
            })}
          </div>
          {!events.length && !eras.length && <div className="canvas-empty"><p className="muted">Nothing on this timeline yet. Double-click anywhere to add an event, or use “Add to timeline”. Drag things sideways to move them in time.</p></div>}
        </div>
      ) : (
        <div className="tl-list">
          {events.map(({ e }) => <EventRow key={e.id} e={e} cal={cal} onClick={() => setSel(e.id)} active={sel === e.id} />)}
          {!events.length && <p className="muted">No events match.</p>}
        </div>
      )}
      {undated.length > 0 && <div className="tl-undated"><span className="muted small">Undated:</span>{undated.map((e) => <button key={e.id} className="chip" onClick={() => setSel(e.id)}>{e.name}</button>)}</div>}
      {calOpen && <CalendarEditor timeline={timeline} onClose={() => setCalOpen(false)} />}
      {adding && <SubjectPicker kind={adding} projectId={projectId} opts={opts} onClose={() => setAdding(null)} onPick={async (id) => {
        const last = events[events.length - 1];
        const evId = await addSubjectEntry(projectId, timeline.id, adding, id, opts, last ? Math.floor(last.v) + 1 : new Date().getFullYear());
        setAdding(null); setSel(evId);
      }} />}
    </div>
  );
}

function SubjectPicker({ kind, projectId, opts, onPick, onClose }: { kind: SubjectKind; projectId: string; opts: Opts; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const rels = useLiveQuery(() => db.links.where('projectId').equals(projectId).filter((l) => l.relation === 'related' && opts.byId.get(l.fromId)?.kind === 'character' && opts.byId.get(l.toId)?.kind === 'character').toArray(), [projectId]);
  const items: { id: string; label: string; sub: string; image?: string }[] =
    kind === 'chapter' ? opts.chapters.map((c) => ({ id: c.id, label: c.title, sub: c.summary.slice(0, 60) })) :
    kind === 'relationship' ? (rels ?? []).map((l) => ({ id: l.id, label: `${opts.byId.get(l.fromId)?.name} & ${opts.byId.get(l.toId)?.name}`, sub: [l.data.label, l.data.reverseLabel].filter(Boolean).join(' / ') || String(l.data.type ?? '') }))
      : opts.entities.filter((e) => e.kind === kind).map((e) => ({ id: e.id, label: e.name || 'Untitled', sub: kind === 'character' ? lifespan(e) : String(e.fields.category ?? e.fields.type ?? ''), image: e.fields.image as string | undefined }));
  const shown = items.filter((i) => (i.label + ' ' + i.sub).toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
  const K = kindDef(kind);
  return (
    <Modal title={`Put a ${K.one.toLowerCase()} on the timeline`} onClose={onClose}>
      <div className="pad col gap-s">
        {kind === 'character' && <p className="muted small">A character's entry starts at their birth year and ends at their death year (from their profile), so it shows their whole life as a bar.</p>}
        {kind === 'relationship' && <p className="muted small">Starts at the year in “When it began” (if it's a year). Drag the end to show how long it lasted.</p>}
        <input className="input" autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && shown[0] && onPick(shown[0].id)} />
        <div className="pick-list">
          {shown.map((i) => (
            <button key={i.id} className="pick-item" onClick={() => onPick(i.id)}>
              {kind === 'character' || kind === 'world' ? <Avatar name={i.label} image={i.image} size={24} round={kind === 'character'} /> : <K.icon size={15} className="muted" />}
              <span className="grow ellipsis">{i.label}</span><span className="muted small ellipsis">{i.sub}</span>
            </button>
          ))}
          {!shown.length && <p className="muted small">{items.length ? 'No matches.' : `No ${K.label.toLowerCase()} in this project yet.`}</p>}
        </div>
      </div>
    </Modal>
  );
}

function EventRow({ e, cal, onClick, active }: { e: Entity; cal: Calendar; onClick: () => void; active?: boolean }) {
  const color = categoryColor(String(e.fields.category), e.fields.color as string);
  return (
    <button className={'tl-row' + (active ? ' on' : '')} onClick={onClick}>
      <span className="tl-row-date">{fmtDate(e.fields.start as FDate, cal)}{e.fields.end ? ` – ${fmtDate(e.fields.end as FDate, cal)}` : ''}</span>
      <span className="dot" style={{ background: color }} />
      <strong className="grow ellipsis">{e.name}</strong>
      {!!e.fields.unresolved && <span className="badge-warn">unresolved</span>}
      <span className="muted small">{String(e.fields.category ?? '')}</span>
    </button>
  );
}

function CalendarEditor({ timeline, onClose }: { timeline: Entity; onClose: () => void }) {
  const [cal, setCal] = useState<Calendar>(structuredClone(calendarOf(timeline)));
  return (
    <Modal title="Calendar" onClose={onClose}>
      <div className="pad col gap">
        <p className="muted small">Use the real-world calendar or invent your own: month names, month lengths and an era label (e.g. “AR” for “After the Rift”).</p>
        <div className="row gap-s"><button className="btn sm" onClick={() => setCal(structuredClone(GREGORIAN))}>Use real-world calendar</button>
          <button className="btn sm" onClick={() => setCal({ era: cal.era, months: Array.from({ length: 10 }, (_, i) => ({ name: `Month ${i + 1}`, days: 36 })) })}>Start a fictional one</button></div>
        <label className="sfield"><span>Era label (after the year)</span><input className="input" value={cal.era} onChange={(e) => setCal({ ...cal, era: e.target.value })} placeholder="e.g. AD, AR, of the Third Age" /></label>
        <div className="cal-months">
          {cal.months.map((m, i) => (
            <div key={i} className="row gap-s">
              <span className="muted small" style={{ width: 22 }}>{i + 1}</span>
              <input className="input sm grow" value={m.name} onChange={(e) => setCal({ ...cal, months: cal.months.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input className="input sm" type="number" min={1} max={400} style={{ width: 70 }} value={m.days} onChange={(e) => setCal({ ...cal, months: cal.months.map((x, j) => (j === i ? { ...x, days: Math.max(1, +e.target.value || 1) } : x)) })} />
              <span className="muted small">days</span>
              <button className="icon-btn sm" onClick={() => setCal({ ...cal, months: cal.months.filter((_, j) => j !== i) })} disabled={cal.months.length < 2}><X size={12} /></button>
            </div>
          ))}
        </div>
        <button className="btn ghost sm" onClick={() => setCal({ ...cal, months: [...cal.months, { name: `Month ${cal.months.length + 1}`, days: 30 }] })}><Plus size={13} /> Add month</button>
        <div className="row end gap-s"><span className="muted small grow">{cal.months.reduce((a, m) => a + m.days, 0)} days per year</span><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => { await updateEntity(timeline.id, { fields: { calendar: cal } }); toast('Calendar saved'); onClose(); }}>Save calendar</button></div>
      </div>
    </Modal>
  );
}

/* ---------------- Event editor ---------------- */

function EventPanel({ ev, data, opts, onClose }: { ev: Entity; data: NonNullable<ReturnType<typeof useTimelineData>>; opts: Opts; onClose: () => void }) {
  const timeline = data.timelines.find((t) => t.id === ev.fields.timelineId) ?? data.timelines[0];
  const cal = calendarOf(timeline);
  const set = (k: string, v: unknown) => updateEntity(ev.id, { fields: { [k]: v } });
  const inv = data.links.filter((l) => l.relation === 'involves' && l.fromId === ev.id);
  const shown = data.links.filter((l) => l.relation === 'shown-in' && l.fromId === ev.id);
  const chip = (l: Link, label: string, onOpen: () => void, img?: Entity) => (
    <span key={l.id} className="linkchip">{img?.kind === 'character' && <Avatar name={img.name} color={img.fields.color as string | undefined} image={img.fields.image as string} size={18} />}<button className="link" onClick={onOpen}>{label}</button><button aria-label="Unlink" onClick={() => removeLink(l.id)}><X size={11} /></button></span>
  );
  return (
    <div className="inspector wide">
      <div className="row gap-s"><span className="dot" style={{ background: categoryColor(String(ev.fields.category), ev.fields.color as string) }} /><strong className="grow">{ev.fields.era ? 'Era' : 'Event'}</strong><button className="icon-btn sm" onClick={onClose}><X size={13} /></button></div>
      {(() => {
        const k = kindOf(ev); if (k === 'event') return null;
        const K = kindDef(k); const subj = ev.fields.subject as { id: string };
        const target = k === 'relationship' || k === 'chapter' ? null : opts.byId.get(subj.id);
        return (
          <div className="subject-bar" style={{ borderColor: K.color }}>
            <K.icon size={14} style={{ color: K.color }} /><span className="grow small">Timeline entry for {k === 'relationship' ? 'a relationship' : <strong>{k === 'chapter' ? opts.chapters.find((c) => c.id === subj.id)?.title ?? '(deleted)' : target?.name ?? '(deleted)'}</strong>}</span>
            {target && <button className="btn ghost sm" onClick={() => openEntity(target)}><ExternalLink size={12} /> Open</button>}
            {k === 'relationship' && <button className="btn ghost sm" onClick={() => go({ view: 'relationships', projectId: ev.projectId })}><ExternalLink size={12} /> Open</button>}
            {k === 'chapter' && <button className="btn ghost sm" onClick={() => { const sc = opts.scenes.filter((x) => x.chapterId === subj.id).sort((a, b) => a.order - b.order)[0]; if (sc) go({ view: 'write', projectId: ev.projectId, sceneId: sc.id }); }}><ExternalLink size={12} /> Open</button>}
          </div>
        );
      })()}
      <Field className="name-field" value={ev.name} onCommit={(v) => updateEntity(ev.id, { name: v || 'Untitled event' })} />
      <label className="sfield"><span>Starts</span><DateInput value={ev.fields.start as FDate} cal={cal} onChange={(d) => d && set('start', d)} /></label>
      <label className="sfield"><span>Ends (optional, for periods)</span><DateInput value={ev.fields.end as FDate | undefined} cal={cal} allowEmpty onChange={(d) => set('end', d)} /></label>
      <div className="row gap-s wrap">
        <select className="pill-select" value={String(ev.fields.category ?? 'Plot')} onChange={(e) => set('category', e.target.value)}>{EVENT_CATEGORIES.map((c) => <option key={c.name}>{c.name}</option>)}</select>
        <label className="color-field"><input type="color" value={String(ev.fields.color || categoryColor(String(ev.fields.category)))} onChange={(e) => set('color', e.target.value)} /><span className="small">Color</span></label>
        <select className="pill-select" value={String(ev.fields.timelineId)} onChange={(e) => set('timelineId', e.target.value)}>{data.timelines.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <label className="check small"><input type="checkbox" checked={!!ev.fields.unresolved} onChange={(e) => set('unresolved', e.target.checked)} /> Unresolved</label>
        <label className="check small" title="Show it as a shaded, named stretch of time behind the timeline"><input type="checkbox" checked={!!ev.fields.era} onChange={(e) => { set('era', e.target.checked || undefined); if (e.target.checked && !ev.fields.end) set('end', { y: ((ev.fields.start as FDate)?.y ?? 0) + 50 }); }} /> Era</label>
      </div>
      <Field label="Description" long value={String(ev.fields.description ?? '')} onCommit={(v) => set('description', v)} />
      <div className="sfield"><div className="row"><span className="grow">Characters involved</span>
        <Picker options={opts.characterOpts} exclude={inv.map((l) => l.toId)} buttonLabel="Add" onPick={(id) => addLink(ev.projectId, 'entity', ev.id, 'entity', id, 'involves')} onCreate={async (n) => addLink(ev.projectId, 'entity', ev.id, 'entity', await createEntity(ev.projectId, 'character', n), 'involves')} /></div>
        <div className="chips">{inv.map((l) => { const e = opts.byId.get(l.toId); if (e?.kind !== 'character') return null; const age = ((ev.fields.start as FDate)?.y ?? NaN) - birthYearOf(e); return chip(l, e.name + (Number.isFinite(age) && age >= 0 ? ` (${age})` : ''), () => openEntity(e), e); })}</div>
      </div>
      <div className="sfield"><div className="row"><span className="grow">Places</span>
        <Picker options={opts.worldOpts} exclude={inv.map((l) => l.toId)} buttonLabel="Add" onPick={(id) => addLink(ev.projectId, 'entity', ev.id, 'entity', id, 'involves')} onCreate={async (n) => addLink(ev.projectId, 'entity', ev.id, 'entity', await createEntity(ev.projectId, 'world', n), 'involves')} /></div>
        <div className="chips">{inv.map((l) => { const e = opts.byId.get(l.toId); return e?.kind === 'world' ? chip(l, e.name, () => openEntity(e)) : null; })}</div>
      </div>
      <div className="sfield"><div className="row"><span className="grow">Shown in chapters / scenes</span>
        <Picker options={opts.sceneOpts} exclude={shown.map((l) => l.toId)} buttonLabel="Add" onPick={(id) => addLink(ev.projectId, 'entity', ev.id, 'scene', id, 'shown-in')} /></div>
        <div className="chips">{shown.map((l) => { const s = opts.sceneOpts.find((o) => o.id === l.toId); return s ? chip(l, s.label, () => go({ view: 'write', projectId: ev.projectId, sceneId: s.id })) : null; })}</div>
      </div>
      <div className="sfield"><span>Image</span><ImageBox image={ev.fields.image as string | undefined} name={ev.name} size={90} onChange={(v) => set('image', v ?? undefined)} /></div>
      <button className="btn ghost sm danger-text" onClick={async () => { onClose(); toastTrashed(ev.name, await deleteEntity(ev.id)); }}><Trash2 size={13} /> Delete event</button>
    </div>
  );
}

/* ---------------- Story timeline (reading order) ---------------- */

const MARKERS: { id: Scene['timeMarker']; label: string }[] = [{ id: '', label: 'In sequence' }, { id: 'flashback', label: 'Flashback' }, { id: 'flashforward', label: 'Flash-forward' }, { id: 'timeskip', label: 'Time skip' }, { id: 'dream', label: 'Dream / vision' }];

function StoryTimeline({ projectId, data, opts, setSel }: { projectId: string; data: NonNullable<ReturnType<typeof useTimelineData>>; opts: Opts; setSel: (id: string) => void }) {
  const chapters = opts.chapters;
  const order = new Map(chapters.map((c, i) => [c.id, i]));
  const scenes = [...opts.scenes].sort((a, b) => (order.get(a.chapterId)! - order.get(b.chapterId)!) || a.order - b.order);
  const calFor = (ev: Entity) => calendarOf(data.timelines.find((t) => t.id === ev.fields.timelineId));
  const eventsOf = (sid: string) => data.links.filter((l) => l.relation === 'shown-in' && l.toId === sid).map((l) => ({ l, e: data.events.find((e) => e.id === l.fromId) })).filter((x) => x.e) as { l: Link; e: Entity }[];
  const points = scenes.map((s, i) => {
    const vs = eventsOf(s.id).map(({ e }) => dateValue(e.fields.start as FDate, calFor(e))).filter(Number.isFinite);
    return { i, s, v: vs.length ? Math.min(...vs) : NaN };
  });
  const dated = points.filter((p) => Number.isFinite(p.v));
  const W = Math.max(560, scenes.length * 46), H = 170;
  const vmin = Math.min(...dated.map((p) => p.v)), vmax = Math.max(...dated.map((p) => p.v));
  const px = (i: number) => 30 + (i / Math.max(1, scenes.length - 1)) * (W - 60);
  const py = (v: number) => vmax === vmin ? H / 2 : 18 + (1 - (v - vmin) / (vmax - vmin)) * (H - 40);

  return (
    <div className="tl story-tl">
      <p className="muted small">Scenes in the order the reader meets them. Link events to scenes to see where each scene sits in world time. Flashbacks show as dips in the chart.</p>
      {dated.length >= 2 ? (
        <div className="chart-scroll">
          <svg width={W} height={H} className="story-chart" role="img" aria-label="Reading order against world chronology">
            <line x1={20} x2={W - 20} y1={H - 12} y2={H - 12} stroke="var(--border)" />
            <text x={20} y={12} fill="var(--muted)" fontSize={10}>later</text><text x={20} y={H - 16} fill="var(--muted)" fontSize={10}>earlier</text>
            <polyline fill="none" stroke="var(--accent)" strokeWidth={1.6} points={dated.map((p) => `${px(p.i)},${py(p.v)}`).join(' ')} />
            {dated.map((p) => (
              <g key={p.s.id} onClick={() => go({ view: 'write', projectId, sceneId: p.s.id })} style={{ cursor: 'pointer' }}>
                <circle cx={px(p.i)} cy={py(p.v)} r={p.s.timeMarker ? 6 : 4} fill={p.s.timeMarker === 'flashback' ? '#e8925a' : p.s.timeMarker ? '#5fa8f5' : 'var(--accent)'} stroke="var(--bg)" strokeWidth={1.5} />
                <title>{`${opts.chapters.find((c) => c.id === p.s.chapterId)?.title} · ${p.s.title}`}</title>
              </g>
            ))}
          </svg>
        </div>
      ) : <p className="muted small chart-hint">The chart appears once two or more scenes have dated events linked to them.</p>}
      <div className="story-rows">
        {chapters.map((c) => (
          <div key={c.id} className="story-ch">
            <div className="story-ch-title" style={{ borderLeftColor: c.color || 'var(--border)' }}>{c.title}</div>
            {scenes.filter((s) => s.chapterId === c.id).map((s) => (
              <div key={s.id} className={'story-row' + (s.timeMarker ? ' marked ' + s.timeMarker : '')}>
                <button className="link ellipsis story-scene" onClick={() => go({ view: 'write', projectId, sceneId: s.id })}><FileText size={13} /> {s.title}</button>
                <select className="pill-select" value={s.timeMarker ?? ''} onChange={(e) => db.scenes.update(s.id, { timeMarker: e.target.value as Scene['timeMarker'] })}>{MARKERS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                <input className="input sm" style={{ width: 150 }} placeholder="e.g. ten years earlier" defaultValue={s.timeNote ?? ''} onBlur={(e) => db.scenes.update(s.id, { timeNote: e.target.value })} />
                <div className="chips grow">
                  {eventsOf(s.id).map(({ l, e }) => (
                    <span key={l.id} className="linkchip"><span className="dot" style={{ background: categoryColor(String(e.fields.category), e.fields.color as string) }} />
                      <button className="link" onClick={() => setSel(e.id)}>{e.name}</button><span className="muted small">{fmtDate(e.fields.start as FDate, calFor(e))}</span>
                      <button aria-label="Unlink" onClick={() => removeLink(l.id)}><X size={11} /></button></span>
                  ))}
                </div>
                <Picker options={data.events.map((e) => ({ id: e.id, label: e.name, sub: fmtDate(e.fields.start as FDate, calFor(e)) }))} exclude={eventsOf(s.id).map((x) => x.e.id)} buttonLabel="Event"
                  onPick={(id) => addLink(projectId, 'entity', id, 'scene', s.id, 'shown-in')}
                  onCreate={async (n) => { const t = data.timelines[0]; const id = await createEvent(projectId, t.id, n, { y: new Date().getFullYear() }); await addLink(projectId, 'entity', id, 'scene', s.id, 'shown-in'); setSel(id); }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Character timeline ---------------- */

function CharacterTimeline({ projectId, characterId, data, opts, setSel }: { projectId: string; characterId?: string; data: NonNullable<ReturnType<typeof useTimelineData>>; opts: Opts; setSel: (id: string) => void }) {
  const chars = opts.entities.filter((e) => e.kind === 'character').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const ch = chars.find((c) => c.id === characterId) ?? chars[0];
  const [cat, setCat] = useState('');
  const rels = useLiveQuery(async () => ch ? (await db.links.where('projectId').equals(projectId).filter((l) => l.relation === 'related' && (l.fromId === ch.id || l.toId === ch.id)).toArray()) : [], [ch?.id]);
  const calFor = (ev: Entity) => calendarOf(data.timelines.find((t) => t.id === ev.fields.timelineId));
  const evs = useMemo(() => !ch ? [] : data.links.filter((l) => l.relation === 'involves' && l.toId === ch.id).map((l) => data.events.find((e) => e.id === l.fromId)).filter(Boolean)
    .map((e) => ({ e: e!, v: dateValue(e!.fields.start as FDate, calFor(e!)) })).filter((x) => !cat || x.e.fields.category === cat).sort((a, b) => (a.v || 0) - (b.v || 0)), [ch, data, cat]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ch) return <div className="edetail-empty"><p className="muted">Create a character first.</p></div>;
  const birth = birthYearOf(ch);
  const addLife = async () => {
    const name = await promptDialog(`New event in ${ch.name}'s life`, '', 'Add');
    if (!name) return;
    const t = data.timelines[0];
    const y = evs.length ? Math.floor(evs[evs.length - 1].v) + 1 : Number.isFinite(birth) ? birth + 10 : new Date().getFullYear();
    const id = await createEvent(projectId, t.id, name, { y }, { category: 'Personal' });
    await addLink(projectId, 'entity', id, 'entity', ch.id, 'involves');
    setSel(id);
  };
  const customRel = data.relTypes;
  const relChanges = (rels ?? []).flatMap((l) => ((l.data.history as RelHistory[] | undefined) ?? []).map((h) => ({ l, h, other: opts.byId.get(l.fromId === ch.id ? l.toId : l.fromId) })));

  return (
    <div className="tl char-tl">
      <div className="tl-bar">
        <select className="pill-select" value={ch.id} onChange={(e) => go({ view: 'timelines', projectId, tab: 'character', characterId: e.target.value })}>{chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <label className="row gap-s small"><span className="muted">Birthday</span><input className="input sm" style={{ width: 120 }} defaultValue={String(ch.fields.birthday ?? '')} key={ch.id + String(ch.fields.birthday)} placeholder="e.g. 23/12/1324" onBlur={async (e) => {
          const input = e.target, v = input.value.trim();
          if (v === String(ch.fields.birthday ?? '').trim()) return;
          if (await confirmLifeChange(ch, { birthday: v })) await updateEntity(ch.id, { fields: { birthday: v } });
          else input.value = String(ch.fields.birthday ?? '');
        }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const t = e.target as HTMLInputElement; setTimeout(() => t.blur()); } }} /></label>
        <select className="pill-select" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{EVENT_CATEGORIES.map((c) => <option key={c.name}>{c.name}</option>)}</select>
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => openEntity(ch)}><ExternalLink size={13} /> Profile</button>
        <button className="btn primary sm" onClick={addLife}><Plus size={13} /> Life event</button>
      </div>
      <div className="life">
        {Number.isFinite(birth) && <div className="life-item born"><span className="life-age">0</span><span className="life-dot" /><div><strong>{ch.name} is born</strong><div className="muted small">{birth}</div></div></div>}
        {evs.map(({ e, v }) => {
          const age = Number.isFinite(birth) && Number.isFinite(v) ? Math.floor(v - birth) : null;
          const others = data.links.filter((l) => l.relation === 'involves' && l.fromId === e.id && l.toId !== ch.id).map((l) => opts.byId.get(l.toId)).filter(Boolean) as Entity[];
          return (
            <button key={e.id} className="life-item" onClick={() => setSel(e.id)}>
              <span className="life-age">{age !== null ? age : '?'}</span>
              <span className="life-dot" style={{ background: categoryColor(String(e.fields.category), e.fields.color as string) }} />
              <div className="col grow" style={{ minWidth: 0 }}>
                <strong>{e.name}{e.fields.unresolved ? ' (unresolved)' : ''}</strong>
                <span className="muted small">{fmtDate(e.fields.start as FDate, calFor(e)) || 'No date'} · {String(e.fields.category ?? '')}{others.length ? ' · with ' + others.map((o) => o.name).join(', ') : ''}</span>
                {!!e.fields.description && <span className="small life-desc">{String(e.fields.description).slice(0, 200)}</span>}
              </div>
            </button>
          );
        })}
        {!evs.length && <p className="muted">No events for {ch.name} yet. Add life events here, or tag {ch.name} in events on the world timeline.</p>}
      </div>
      {relChanges.length > 0 && (
        <div className="note-section">
          <h4>Relationship changes</h4>
          {relChanges.map(({ h, other }) => (
            <div key={h.id} className="linkrow"><span className="dot" style={{ background: relType(h.type, customRel).color }} /><span><strong>{other?.name}</strong>: {relType(h.type, customRel).label}{h.when ? ` · ${h.when}` : ''}{h.note ? ` — ${h.note}` : ''}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The timeline never changes a character's dates without asking first */
function confirmLifeChange(c: Entity, patch: { birthday?: string; deathYear?: string }) {
  const b0 = birthYearOf(c), d0 = deathYearOf(c);
  const b1 = 'birthday' in patch ? yearFrom(patch.birthday) : b0;
  const d1 = 'deathYear' in patch ? yearFrom(patch.deathYear) : d0;
  const span = (b: number, d: number) => Number.isFinite(b) ? (Number.isFinite(d) ? `${b}–${d}` : `${b} onwards`) : Number.isFinite(d) ? `until ${d}` : 'no dates';
  const sameYears = (b0 === b1 || (isNaN(b0) && isNaN(b1))) && (d0 === d1 || (isNaN(d0) && isNaN(d1)));
  const from = sameYears ? `“${String(c.fields.birthday ?? '') || 'blank'}”` : span(b0, d0);
  const to = sameYears ? `“${patch.birthday || 'blank'}”` : span(b1, d1);
  return confirmDialog(`Are you sure you want to change ${c.name}'s timeline from ${from} to ${to}?`, 'This changes the dates on their character page too.', { ok: 'Change' });
}
