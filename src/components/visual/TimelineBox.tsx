import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { Plus, X, GanttChart } from 'lucide-react';
import { db, type Entity } from '../../db';
import { addLink, deleteEntity, updateEntity } from '../../entities';
import { calendarOf, createEvent, dateValue, ensureTimeline, fmtDate, type FDate } from '../../story3';
import { go } from '../../nav';
import { DateInput, type SubjectKind } from './Timelines';
import { birthYearOf, deathYearOf } from '../../charDates';

/* "On the timeline" box shown on character, place, note, map, relationship and chapter pages. */

function useTimelines(projectId: string) {
  useEffect(() => { ensureTimeline(projectId); }, [projectId]);
  return useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'timeline']).sortBy('createdAt'), [projectId]);
}

const openOn = (projectId: string, timelineId: string, eventId?: string) => go({ view: 'timelines', projectId, tab: 'world', timelineId, eventId });

/** Place a place / note / map / relationship / chapter on one or more timelines, with a date or period */
export function TimelineBox({ projectId, kind, id, name, involve = [] }: { projectId: string; kind: Exclude<SubjectKind, 'event' | 'character'>; id: string; name: string; involve?: string[] }) {
  const timelines = useTimelines(projectId);
  const entries = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'event'])
    .filter((e) => (e.fields.subject as { id?: string } | undefined)?.id === id).toArray(), [projectId, id]);
  if (!timelines?.length || !entries) return null;

  const add = async () => {
    const t = timelines[0];
    const evId = await createEvent(projectId, t.id, name || 'Untitled', { y: new Date().getFullYear() }, { subject: { type: kind, id }, category: kind === 'chapter' ? 'Plot' : kind === 'relationship' ? 'Personal' : 'History' });
    for (const x of involve) await addLink(projectId, 'entity', evId, 'entity', x, 'involves');
  };

  return (
    <div className="tlbox">
      {entries.map((ev) => <Placement key={ev.id} ev={ev} timelines={timelines} projectId={projectId} />)}
      {!entries.length && <p className="muted small">Not on a timeline yet. Add it to show {kind === 'chapter' ? 'when this chapter takes place' : kind === 'relationship' ? 'when this relationship lasted' : 'when this happened, was founded or existed'}.</p>}
      <button className="btn ghost sm" onClick={add}><Plus size={13} /> {entries.length ? 'Add another date' : 'Put on a timeline'}</button>
    </div>
  );
}

function Placement({ ev, timelines, projectId }: { ev: Entity; timelines: Entity[]; projectId: string }) {
  const t = timelines.find((x) => x.id === ev.fields.timelineId) ?? timelines[0];
  const cal = calendarOf(t);
  const set = (patch: Record<string, unknown>) => updateEntity(ev.id, { fields: patch });
  const start = ev.fields.start as FDate | undefined, end = ev.fields.end as FDate | undefined;
  return (
    <div className="placement">
      <div className="row gap-s">
        <select className="pill-select grow" value={t.id} onChange={(e) => set({ timelineId: e.target.value })} aria-label="Timeline">
          {timelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className="icon-btn sm" title="Show on the timeline" onClick={() => openOn(projectId, t.id, ev.id)}><GanttChart size={13} /></button>
        <button className="icon-btn sm" title="Remove from this timeline" onClick={() => deleteEntity(ev.id, { trash: false })}><X size={12} /></button>
      </div>
      <input className="input sm" defaultValue={ev.name} placeholder="Label, e.g. Founded" title="What happened" onBlur={(e) => updateEntity(ev.id, { name: e.target.value || ev.name })} />
      <label className="sfield"><span>From</span><DateInput value={start} cal={cal} onChange={(d) => d && set({ start: d })} /></label>
      <label className="sfield"><span>Until (optional)</span><DateInput value={end} cal={cal} allowEmpty onChange={(d) => set({ end: d })} /></label>
      {Number.isFinite(dateValue(end, cal)) && <span className="muted small">{fmtDate(start, cal)} – {fmtDate(end, cal)}</span>}
    </div>
  );
}

/** Characters appear on a timeline automatically from their birth and death year */
export function CharacterTimelineBox({ c }: { c: Entity }) {
  const timelines = useTimelines(c.projectId);
  if (!timelines?.length) return null;
  const tid = timelines.some((t) => t.id === c.fields.lifeTimelineId) ? (c.fields.lifeTimelineId as string) : timelines[0].id;
  const b = birthYearOf(c), d = deathYearOf(c);
  const set = (patch: Record<string, unknown>) => updateEntity(c.id, { fields: patch });
  return (
    <div className="tlbox">
      <div className="row gap-s">
        <select className="pill-select grow" value={tid} onChange={(e) => set({ lifeTimelineId: e.target.value })} aria-label="Timeline">
          {timelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className="icon-btn sm" title="Show on the timeline" onClick={() => openOn(c.projectId, tid)}><GanttChart size={13} /></button>
      </div>
      <div className="row gap-s">
        <label className="sfield grow"><span>Birthday</span><input className="input sm" defaultValue={String(c.fields.birthday ?? '')} key={'b' + c.fields.birthday} placeholder="e.g. 23/12/1324" onBlur={(e) => set({ birthday: e.target.value.trim() })} /></label>
        <label className="sfield grow"><span>Death year</span><input className="input sm" defaultValue={String(c.fields.deathYear ?? '')} key={'d' + c.fields.deathYear} placeholder="—" onBlur={(e) => set({ deathYear: e.target.value.trim() })} /></label>
      </div>
      <p className="muted small">{Number.isFinite(b)
        ? (c.fields.hideOnTimeline ? 'Hidden from the timeline.' : `Shown automatically as ${b}${Number.isFinite(d) ? `–${d}` : ' onwards'}.`)
        : 'Add a birthday with a year and they appear on the timeline automatically.'}</p>
      {Number.isFinite(b) && <label className="check small"><input type="checkbox" checked={!c.fields.hideOnTimeline} onChange={(e) => set({ hideOnTimeline: !e.target.checked })} /> Show on the timeline</label>}
      <button className="btn ghost sm" onClick={() => go({ view: 'timelines', projectId: c.projectId, tab: 'character', characterId: c.id })}>Life events…</button>
    </div>
  );
}
