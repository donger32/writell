/*
 * Project to-do list: "fix the ending of chapter 4", "research sword types"…
 * Each task can have a due date and point at a chapter or a character.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { CalendarDays, ChevronRight, ListChecks, Trash2, X } from 'lucide-react';
import { db, type Entity } from '../../db';
import { createEntity, deleteEntity, updateEntity } from '../../entities';
import { go } from '../../nav';
import { openEntity } from './links';
import { useProjectOptions } from './common';

const today = () => new Date().toISOString().slice(0, 10);

export function TasksView({ projectId }: { projectId: string }) {
  const tasks = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'task']).toArray(), [projectId]);
  const opts = useProjectOptions(projectId);
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  if (!tasks || !opts) return null;
  const open = tasks.filter((t) => !t.fields.done).sort((a, b) => String(a.fields.due || '9999').localeCompare(String(b.fields.due || '9999')) || a.createdAt - b.createdAt);
  const done = tasks.filter((t) => t.fields.done).sort((a, b) => Number(b.fields.doneAt ?? 0) - Number(a.fields.doneAt ?? 0));
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    await createEntity(projectId, 'task', t, { done: false });
    setText('');
  };
  return (
    <div className="page tasks-page">
      <header className="page-head">
        <div>
          <h1>Tasks</h1>
          <p className="muted">Things to do for this book. Give one a date or point it at a chapter or character if that helps.</p>
        </div>
      </header>
      <form className="task-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <ListChecks size={16} className="muted" />
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task and press Enter, e.g. Rewrite the ending of chapter 4" aria-label="New task" />
        <button className="btn primary sm" disabled={!text.trim()}>Add</button>
      </form>
      {!tasks.length && <p className="muted small">Nothing yet. Tasks you add appear here, with the ones due soonest first.</p>}
      <ul className="task-list">
        {open.map((t) => <TaskRow key={t.id} t={t} opts={opts} />)}
      </ul>
      {done.length > 0 && (
        <>
          <button className="btn ghost sm task-done-toggle" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            <ChevronRight size={13} className={'chev' + (showDone ? ' open' : '')} /> Completed ({done.length})
          </button>
          {showDone && <ul className="task-list done">{done.map((t) => <TaskRow key={t.id} t={t} opts={opts} />)}</ul>}
        </>
      )}
    </div>
  );
}

function TaskRow({ t, opts }: { t: Entity; opts: NonNullable<ReturnType<typeof useProjectOptions>> }) {
  const set = (fields: Record<string, unknown>) => updateEntity(t.id, { fields });
  const due = String(t.fields.due ?? '');
  const late = !t.fields.done && due && due < today();
  const about = String(t.fields.about ?? '');
  const aboutEnt = opts.byId.get(about);
  const aboutCh = opts.chapters.find((c) => c.id === about);
  return (
    <li className={'task-row' + (t.fields.done ? ' is-done' : '')}>
      <input type="checkbox" checked={!!t.fields.done} aria-label={t.fields.done ? 'Mark as not done' : 'Mark as done'} onChange={(e) => set({ done: e.target.checked, doneAt: e.target.checked ? Date.now() : undefined })} />
      <input className="task-text" defaultValue={t.name} key={t.name} aria-label="Task" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) updateEntity(t.id, { name: v }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {aboutEnt && <button className="chip task-about" onClick={() => openEntity(aboutEnt)} title="Open">{aboutEnt.name}</button>}
      {aboutCh && <button className="chip task-about" onClick={() => go({ view: 'project', projectId: t.projectId })} title="Chapter">{aboutCh.title}</button>}
      <select className="task-link" value={about} onChange={(e) => set({ about: e.target.value || undefined })} aria-label="About" title="Link to a chapter or character">
        <option value="">Link…</option>
        <optgroup label="Chapters">{opts.chapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</optgroup>
        <optgroup label="Characters">{opts.characterOpts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>
        <optgroup label="World">{opts.worldOpts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>
      </select>
      <label className={'task-due' + (late ? ' late' : '') + (due ? ' set' : '')} title={late ? 'Overdue' : 'Due date'}>
        <CalendarDays size={13} />
        <input type="date" value={due} onChange={(e) => set({ due: e.target.value || undefined })} aria-label="Due date" />
        {due && <button type="button" className="icon-btn sm" aria-label="Clear date" onClick={() => set({ due: undefined })}><X size={11} /></button>}
      </label>
      <button className="icon-btn sm task-del" title="Delete task" aria-label="Delete task" onClick={() => deleteEntity(t.id, { trash: false })}><Trash2 size={13} /></button>
    </li>
  );
}

/** Open tasks count for the sidebar badge */
export function useOpenTasks(projectId: string | null) {
  return useLiveQuery(async () => projectId ? db.entities.where('[projectId+kind]').equals([projectId, 'task']).filter((t) => !t.fields.done).count() : 0, [projectId]);
}
