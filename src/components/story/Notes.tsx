import { useLiveQuery } from 'dexie-react-hooks';
import { TypePicker } from './TypePicker';
import { useState } from 'react';
import { Paperclip, Download, Upload, Folder, Pin, Trash2, Plus, X, Inbox, ImagePlus, FileText, BookOpen, Check, Hash, Tags } from 'lucide-react';
import { db, uid, now, type Entity } from '../../db';
import { saveBinary } from '../../util';
import { NOTE_TYPES, noteTypesOf, setNoteTypes, addLink, createEntity, deleteEntity, pickImage, removeLink, updateEntity } from '../../entities';
import { toastTrashed } from '../TrashView';
import { go } from '../../nav';
import { Modal, confirmDialog, toast } from '../ui';
import { Avatar, Field, Picker, TagEditor, useProjectOptions } from './common';
import { EntityShell } from './EntityShell';
import { openEntity } from './links';
import { TimelineBox } from '../visual/TimelineBox';

/** Pick .txt / .md files; each becomes a note in the Inbox (a first "# Heading" becomes its title) */
function importNoteFiles(projectId: string) {
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.accept = '.txt,.md,.markdown,text/plain,text/markdown';
  input.onchange = async () => {
    const files = Array.from(input.files ?? []);
    let n = 0;
    for (const f of files) {
      try {
        let body = (await f.text()).replace(/\r\n/g, '\n').trim();
        let title = f.name.replace(/\.(txt|md|markdown)$/i, '');
        const h = body.match(/^#{1,3}\s+(.+)\n?/);
        if (h) { title = h[1].trim(); body = body.slice(h[0].length).trim(); }
        await createEntity(projectId, 'note', title, { type: 'Idea', folder: '', body, inbox: true });
        n++;
      } catch { /* skip unreadable file */ }
    }
    if (n) toast(`Imported ${n} note${n > 1 ? 's' : ''} into the Inbox`);
  };
  input.click();
}

export function NotesView({ projectId, entityId, filter: initial }: { projectId: string; entityId?: string; filter?: string }) {
  const items = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'note']).toArray(), [projectId]);
  const opts = useProjectOptions(projectId);
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const [filter, setFilter] = useState(initial ?? 'All');
  const [managing, setManaging] = useState(false);
  if (!items || !opts) return null;
  const usedTags = [...new Set(items.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b));
  const tagList = [...new Set([...(project?.noteTags ?? []), ...usedTags])].sort((a, b) => a.localeCompare(b));
  const types = noteTypesOf(project);
  const usedTypes = [...new Set(items.map((n) => String(n.fields.type ?? '')).filter(Boolean))];
  const folders = [...new Set(items.map((n) => String(n.fields.folder ?? '')).filter(Boolean))].sort();
  const inboxCount = items.filter((n) => n.fields.inbox).length;
  const shown = items.filter((n) =>
    filter === 'All' ? true : filter === 'Inbox' ? n.fields.inbox : filter === 'Pinned' ? n.fields.pinned : filter === 'Open threads' ? n.fields.type === 'Plot thread' && !n.fields.resolved
      : filter.startsWith('folder:') ? n.fields.folder === filter.slice(7) : filter.startsWith('tag:') ? n.tags.includes(filter.slice(4)) : n.fields.type === filter,
  ).map((n) => ({ ...n, favorite: !!n.fields.pinned })); // pinned notes float to the top
  const create = async () => {
    const type = usedTypes.includes(filter) || types.includes(filter) ? filter : types.includes('Idea') ? 'Idea' : types[0] ?? '';
    const folder = filter.startsWith('folder:') ? filter.slice(7) : '';
    const id = await createEntity(projectId, 'note', '', { type, folder, body: '', inbox: filter === 'Inbox' });
    if (filter.startsWith('tag:')) await updateEntity(id, { tags: [filter.slice(4)] });
    go({ view: 'notes', projectId, entityId: id });
  };
  const active = items.find((n) => n.id === entityId);
  return (
    <>
    <EntityShell title="Notes" items={shown} activeId={entityId} showAvatar={false} onOpen={(id) => go({ view: 'notes', projectId, entityId: id })}
      onNew={create} newLabel="Note"
      renderSub={(n) => [n.fields.inbox ? 'Inbox' : String(n.fields.type ?? '') + (n.fields.type === 'Plot thread' ? (n.fields.resolved ? ' (resolved)' : ' (open)') : ''), String(n.fields.body ?? '').slice(0, 80)].filter(Boolean).join(' · ')}
      filters={
        <div className="filter-chips">
          {['All', 'Inbox', 'Pinned', ...(items.some((n) => n.fields.type === 'Plot thread') ? ['Open threads'] : [])].map((c) => <button key={c} className={'chip' + (filter === c ? ' on' : '')} onClick={() => setFilter(c)}>{c === 'Inbox' ? `Inbox${inboxCount ? ` (${inboxCount})` : ''}` : c}</button>)}
          {[...types.filter((t) => usedTypes.includes(t)), ...usedTypes.filter((t) => !types.includes(t))].map((c) => <button key={c} className={'chip' + (filter === c ? ' on' : '')} onClick={() => setFilter(c)}>{c}</button>)}
          {folders.map((f) => <button key={f} className={'chip' + (filter === 'folder:' + f ? ' on' : '')} onClick={() => setFilter('folder:' + f)}><Folder size={11} /> {f}</button>)}
          {usedTags.map((t) => <button key={'t' + t} className={'chip' + (filter === 'tag:' + t ? ' on' : '')} onClick={() => setFilter(filter === 'tag:' + t ? 'All' : 'tag:' + t)}><Hash size={11} />{t}</button>)}
          <button className="chip" title="Add, rename or remove tags" onClick={() => setManaging(true)}><Tags size={11} /> Tags…</button>
          <button className="chip" title="Turn text or Markdown files into notes (they land in the Inbox)" onClick={() => importNoteFiles(projectId)}><Upload size={11} /> Import…</button>
        </div>
      }
      empty={<><h3>Notes & ideas</h3><p className="muted">Press <kbd>Ctrl + Shift + N</kbd> anywhere to jot an idea into the inbox without deciding where it belongs.</p><button className="btn primary" onClick={create}><Plus size={14} /> New note</button></>}>
      {active ? <NoteEditor key={active.id} n={active} opts={opts} folders={folders} types={types} all={items} tagList={tagList} onManage={() => setManaging(true)} /> : undefined}
    </EntityShell>
    {managing && <ManageTags projectId={projectId} notes={items} tags={tagList} saved={project?.noteTags ?? []} onClose={() => setManaging(false)}
      onRenamed={(a, b) => { if (filter === 'tag:' + a) setFilter(b ? 'tag:' + b : 'All'); }} />}
    </>
  );
}

function NoteEditor({ n, opts, folders, types, all, tagList, onManage }: { n: Entity; opts: NonNullable<ReturnType<typeof useProjectOptions>>; folders: string[]; types: string[]; all: Entity[]; tagList: string[]; onManage: () => void }) {
  const set = (k: string, v: unknown) => updateEntity(n.id, { fields: { [k]: v } });
  const images = (n.fields.images as string[] | undefined) ?? [];
  const links = useLiveQuery(() => db.links.where('[fromType+fromId]').equals(['entity', n.id]).filter((l) => l.relation === 'about').toArray(), [n.id]);
  const [big, setBig] = useState<string | null>(null);
  const allOpts = [...opts.characterOpts, ...opts.worldOpts, ...opts.chapterOpts, ...opts.sceneOpts];
  const linkedIds = links?.map((l) => l.toId) ?? [];
  const typeOf = (id: string) => opts.byId.has(id) ? 'entity' : opts.chapters.some((c) => c.id === id) ? 'chapter' : 'scene';

  return (
    <div className="note-editor">
      <div className="note-main">
      <div className="row gap-s wrap note-bar">
        {!!n.fields.inbox && <button className="btn sm" onClick={() => set('inbox', false)}><Check size={13} /> File it (remove from inbox)</button>}
        {!n.fields.inbox && <button className="btn ghost sm" onClick={() => set('inbox', true)}><Inbox size={13} /> Back to inbox</button>}
        <TypePicker value={String(n.fields.type ?? '')} types={types.map((name) => ({ name }))} what="type"
          countOf={(t) => all.filter((x) => x.fields.type === t).length}
          onPick={(t) => set('type', t)}
          onAdd={(t) => void setNoteTypes(n.projectId, [...types, t])}
          onRemove={(t) => void setNoteTypes(n.projectId, types.filter((x) => x !== t))}
          onReset={NOTE_TYPES.every((t) => types.includes(t)) ? undefined : () => void setNoteTypes(n.projectId, [...NOTE_TYPES, ...types.filter((t) => !(NOTE_TYPES as readonly string[]).includes(t))])} />
        {n.fields.type === 'Plot thread' && <label className="check small"><input type="checkbox" checked={!!n.fields.resolved} onChange={(e) => set('resolved', e.target.checked)} /> Resolved</label>}
        <input className="pill-select" list="note-folders" placeholder="Folder…" defaultValue={String(n.fields.folder ?? '')} onBlur={(e) => set('folder', e.target.value.trim())} style={{ width: 130 }} />
        <datalist id="note-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
        <span className="grow" />
        <button className={'icon-btn' + (n.fields.pinned ? ' on' : '')} title="Pin note" onClick={() => set('pinned', !n.fields.pinned)}><Pin size={15} /></button>
        <button className="icon-btn" title="Delete note" onClick={async () => { go({ view: 'notes', projectId: n.projectId }); toastTrashed(n.name || 'Note', await deleteEntity(n.id)); }}><Trash2 size={15} /></button>
      </div>
      <div className="note-tags"><TagEditor tags={n.tags} suggestions={[...new Set([...tagList, ...opts.allTags])]} onChange={(tags) => updateEntity(n.id, { tags })} onManage={onManage} /></div>
      <Field wrap className="name-field" value={n.name} placeholder="Title" onCommit={(v) => updateEntity(n.id, { name: v })} />
      <Field className="note-body" value={String(n.fields.body ?? '')} long placeholder="Write anything…" onCommit={(v) => set('body', v)} />
      </div>

      <div className="note-side">
      <div className="note-section">
        <div className="row"><h4 className="grow">Linked to</h4>
          <Picker options={allOpts} exclude={linkedIds} buttonLabel="Link" placeholder="Character, place, chapter, scene…" onPick={(id) => addLink(n.projectId, 'entity', n.id, typeOf(id), id, 'about')} />
        </div>
        <div className="chips">
          {links?.map((l) => {
            const ent = opts.byId.get(l.toId);
            const ch = opts.chapters.find((c) => c.id === l.toId);
            const sc = opts.sceneOpts.find((s) => s.id === l.toId);
            const label = ent?.name ?? ch?.title ?? sc?.label ?? '(deleted)';
            const open = () => ent ? openEntity(ent) : ch ? go({ view: 'project', projectId: n.projectId }) : sc && go({ view: 'write', projectId: n.projectId, sceneId: sc.id });
            return (
              <span key={l.id} className="linkchip">
                {ent?.kind === 'character' ? <Avatar name={label} image={ent.fields.image as string} size={18} /> : ch ? <BookOpen size={12} /> : sc ? <FileText size={12} /> : null}
                <button className="link" onClick={open}>{label}</button>
                <button aria-label="Unlink" onClick={() => removeLink(l.id)}><X size={11} /></button>
              </span>
            );
          })}
          {!linkedIds.length && <span className="muted small">Not linked to anything yet.</span>}
        </div>
      </div>

      <div className="note-section">
        <div className="row"><h4 className="grow">Image references</h4>
          <button className="btn ghost sm" onClick={async () => { const d = await pickImage(1400); if (d) set('images', [...images, d]); }}><ImagePlus size={13} /> Add image</button>
        </div>
        <div className="img-grid">
          {images.map((src, i) => (
            <div key={i} className="img-tile">
              <img src={src} alt="" onClick={() => setBig(src)} />
              <button className="tile-x" aria-label="Remove image" onClick={() => set('images', images.filter((_, j) => j !== i))}><X size={12} /></button>
            </div>
          ))}
        </div>
      </div>
      <div className="note-section"><h4>On the timeline</h4><TimelineBox projectId={n.projectId} kind="note" id={n.id} name={n.name || 'Note'} involve={[n.id]} /></div>
      <Attachments ownerId={n.id} projectId={n.projectId} />
      </div>
      {big && <div className="overlay" onMouseDown={() => setBig(null)}><img src={big} alt="" className="lightbox" /></div>}
    </div>
  );
}

/** Ctrl+Shift+N — capture an idea without leaving what you're doing */
export function QuickNote({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const projects = useLiveQuery(() => db.projects.orderBy('openedAt').reverse().filter((p) => !p.archived).toArray(), []);
  const [pid, setPid] = useState(projectId ?? '');
  const [text, setText] = useState('');
  const target = pid || projects?.[0]?.id || '';
  const save = async () => {
    if (!text.trim() || !target) return onClose();
    const [first, ...rest] = text.trim().split('\n');
    await createEntity(target, 'note', first.slice(0, 80), { type: 'Idea', body: first.length > 80 ? text.trim() : rest.join('\n').trim(), inbox: true });
    toast('Saved to inbox');
    onClose();
  };
  return (
    <div className="overlay top" onMouseDown={(e) => e.target === e.currentTarget && save()}>
      <div className="dialog quicknote" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}>
        <div className="row gap-s"><Inbox size={16} className="accent" /><h3 className="grow">Quick idea</h3>
          {projects && projects.length > 1 && <select className="pill-select" value={target} onChange={(e) => setPid(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>}
        </div>
        {!projects?.length ? <p className="muted">Create a project first.</p> : (
          <textarea className="input" rows={5} autoFocus placeholder="What if the lighthouse keeper was the one who…" value={text} onChange={(e) => setText(e.target.value)} />
        )}
        <div className="row end gap-s"><span className="muted small grow">Ctrl + Enter to save · Esc to discard</span>
          <button className="btn ghost" onClick={onClose}>Discard</button><button className="btn primary" onClick={save}>Save to inbox</button></div>
      </div>
    </div>
  );
}

const MAX_FILE = 50 * 1024 * 1024;
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Any files (PDFs, documents, audio…) attached to a note, stored inside the project */
export function Attachments({ ownerId, projectId }: { ownerId: string; projectId: string }) {
  const files = useLiveQuery(() => db.files.where('ownerId').equals(ownerId).sortBy('createdAt'), [ownerId]);
  const [over, setOver] = useState(false);
  const add = async (list: FileList | File[]) => {
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) { toast(`${f.name} is larger than 50 MB`); continue; }
      await db.files.add({ id: uid(), projectId, ownerId, name: f.name, type: f.type || 'application/octet-stream', size: f.size, data: f, createdAt: Date.now() });
    }
  };
  const pick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.onchange = () => i.files && add(i.files); i.click(); };
  return (
    <div className={'note-section' + (over ? ' drop-on' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
      <div className="row"><h4 className="grow">Attachments</h4><button className="btn ghost sm" onClick={pick}><Paperclip size={13} /> Attach file</button></div>
      {!files?.length && <p className="muted small">Attach research PDFs, documents, audio or anything else (up to 50 MB each), or drop files here. They're kept inside the project and included in full backup files.</p>}
      {files?.map((f) => (
        <div key={f.id} className="row gap-s file-row">
          <Paperclip size={13} className="muted" />
          <span className="grow ellipsis">{f.name}</span><span className="muted small">{fmtSize(f.size)}</span>
          <button className="icon-btn sm" title="Save a copy" aria-label={`Save ${f.name}`} onClick={async () => saveBinary(f.name, new Uint8Array(await f.data.arrayBuffer()), f.type)}><Download size={13} /></button>
          <button className="icon-btn sm" title="Remove" aria-label={`Remove ${f.name}`} onClick={async () => { if (await confirmDialog(`Remove ${f.name}?`, undefined, { danger: true, ok: 'Remove' })) db.files.delete(f.id); }}><Trash2 size={13} /></button>
        </div>
      ))}
    </div>
  );
}

/** Add tags ahead of time, rename a tag on every note, or take it off every note */
function ManageTags({ projectId, notes, tags, saved, onClose, onRenamed }: { projectId: string; notes: Entity[]; tags: string[]; saved: string[]; onClose: () => void; onRenamed: (from: string, to: string | null) => void }) {
  const [v, setV] = useState('');
  const count = (t: string) => notes.filter((n) => n.tags.includes(t)).length;
  const saveList = (list: string[]) => db.projects.update(projectId, { noteTags: [...new Set(list)], updatedAt: now() });
  const add = async () => { const t = v.trim().replace(/^#/, ''); if (!t) return; if (!tags.includes(t)) await saveList([...saved, t]); setV(''); };
  const rename = async (from: string, raw: string) => {
    const to = raw.trim().replace(/^#/, '');
    if (!to || to === from) return;
    for (const n of notes) if (n.tags.includes(from)) await updateEntity(n.id, { tags: [...new Set(n.tags.map((x) => x === from ? to : x))] });
    await saveList(saved.map((x) => x === from ? to : x));
    onRenamed(from, to); toast(`#${from} is now #${to}`);
  };
  const remove = async (t: string) => {
    const c = count(t);
    if (c && !(await confirmDialog(`Remove #${t}?`, `It comes off ${c} ${c === 1 ? 'note' : 'notes'}. The notes themselves are kept.`, { danger: true, ok: 'Remove' }))) return;
    for (const n of notes) if (n.tags.includes(t)) await updateEntity(n.id, { tags: n.tags.filter((x) => x !== t) });
    await saveList(saved.filter((x) => x !== t));
    onRenamed(t, null);
  };
  return (
    <Modal title="Note tags" onClose={onClose}>
      <div className="col gap-s manage-tags">
        <div className="row gap-s">
          <input className="input grow" autoFocus value={v} placeholder="New tag, e.g. act-two" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
          <button className="btn primary sm" onClick={() => void add()} disabled={!v.trim()}><Plus size={13} /> Add</button>
        </div>
        {!tags.length && <p className="muted small">No tags yet. Add some here, or type one on any note.</p>}
        <div className="tag-rows">
          {tags.map((t) => (
            <div key={t} className="tag-row">
              <Hash size={13} className="muted" />
              <input className="tag-name" defaultValue={t} aria-label={`Rename ${t}`} onBlur={(e) => void rename(t, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              <span className="muted small">{count(t)} {count(t) === 1 ? 'note' : 'notes'}</span>
              <button className="icon-btn sm" title={`Remove #${t}`} aria-label={`Remove ${t}`} onClick={() => void remove(t)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <p className="muted small">Click a name to rename it on every note.</p>
      </div>
    </Modal>
  );
}
