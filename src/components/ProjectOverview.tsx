import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Plus, Download, FileText, Star, MoreHorizontal, History, Settings2, PenLine, ChevronRight, Pencil, GanttChart, Share2 } from 'lucide-react';
import { sharedRole, useSharedRoles } from '../sync/engine';
import { TimelineBox } from './visual/TimelineBox';
import { db, createChapter, autoBackup, importProject, type Status } from '../db';
import { go, setNav, getRecentScenes } from '../nav';
import { fmtNum, fmtReading, timeAgo } from '../util';
import { Modal, STATUS_COLOR, STATUS_LABEL, confirmDialog, openMenu, promptDialog, toast } from './ui';
import { exportBackupFile, exportChapterMarkdown, exportAllEntitiesMarkdown } from '../exporting';
import { ImageBox } from './story/common';
import { projectMenu } from './Home';

const COLORS = ['#8b7cf6', '#5fa8f5', '#5fbf8f', '#e8925a', '#e06c75', '#d17ad8', '#e8c547', '#6b7280'];

/** A calm summary of the project: what it is, how far along, and the chapters. Everything else is in Project settings. */
export function ProjectOverview({ projectId }: { projectId: string }) {
  useSharedRoles(); // re-render when sharing changes
  const p = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const chapters = useLiveQuery(() => db.chapters.where('projectId').equals(projectId).sortBy('order'), [projectId]);
  const scenes = useLiveQuery(() => db.scenes.where('projectId').equals(projectId).toArray(), [projectId]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [settings, setSettingsOpen] = useState(false);
  const [tlFor, setTlFor] = useState<string | null>(null);
  if (!p || !chapters || !scenes) return null;
  const total = scenes.reduce((a, s) => a + s.words, 0);
  const done = chapters.filter((c) => c.status === 'done').length;
  const pct = p.goalWords ? Math.min(100, Math.round((total / p.goalWords) * 100)) : null;
  const lastScene = getRecentScenes().map((id) => scenes.find((s) => s.id === id)).find(Boolean) ?? [...scenes].sort((a, b) => b.updatedAt - a.updatedAt)[0];

  const chapterMenu = (e: React.MouseEvent, c: (typeof chapters)[number]) => openMenu(e, [
    { label: 'Place on a timeline…', icon: <GanttChart size={14} />, onClick: () => setTlFor(c.id) },
    { label: 'Edit summary', icon: <Pencil size={14} />, onClick: async () => { const t = await promptDialog(`Summary of “${c.title}”`, c.summary, 'Save'); if (t !== null) db.chapters.update(c.id, { summary: t }); } },
    ...(Object.keys(STATUS_LABEL) as Status[]).map((st) => ({ label: `Mark as ${STATUS_LABEL[st].toLowerCase()}`, icon: <span className="status-dot" style={{ background: STATUS_COLOR[st] }} />, onClick: () => db.chapters.update(c.id, { status: st }) })),
    { divider: true, label: '', onClick: () => {} },
    { label: 'Export chapter (.md)', icon: <Download size={14} />, onClick: () => exportChapterMarkdown(c.id) },
  ]);

  return (
    <div className="page overview">
      <header className="ov-head">
        <ImageBox image={p.coverImage} name={p.title} size={72} onChange={(v) => db.projects.update(p.id, { coverImage: v ?? undefined })} />
        <div className="grow" style={{ minWidth: 0 }}>
          <input className="h1-input" value={p.title} onChange={(e) => db.projects.update(p.id, { title: e.target.value })} aria-label="Project title" />
          <textarea className="desc-input" rows={1} placeholder="Add a one-line description…" value={p.description} onChange={(e) => db.projects.update(p.id, { description: e.target.value })} aria-label="Description" />
        </div>
        <div className="row gap-s">
          <button className="icon-btn" title={p.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => db.projects.update(p.id, { favorite: !p.favorite })}><Star size={16} fill={p.favorite ? 'currentColor' : 'none'} className={p.favorite ? 'accent' : ''} /></button>
          <button className="icon-btn" title="More" onClick={(e) => projectMenu(e, p)}><MoreHorizontal size={16} /></button>
        </div>
      </header>

      <div className="ov-progress">
        <p>
          <strong>{fmtNum(total)}</strong> words · {chapters.length} chapter{chapters.length === 1 ? '' : 's'} · {done} done · {fmtReading(total / 238)} read
          {p.deadline && <> · due {new Date(p.deadline + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</>}
        </p>
        {pct !== null && <div className="progress big" title={`${pct}% of ${fmtNum(p.goalWords)} words`}><div style={{ width: pct + '%' }} /></div>}
        {pct !== null && <span className="muted small">{pct}% of your {fmtNum(p.goalWords)}-word target</span>}
      </div>

      <div className="row gap-s wrap ov-actions">
        {lastScene && <button className="btn primary" onClick={() => go({ view: 'write', projectId, sceneId: lastScene.id })}><PenLine size={14} /> Continue writing</button>}
        <button className="btn" onClick={() => setNav({ exportFor: projectId })}><FileText size={14} /> Export</button>
        <button className="btn" onClick={() => setNav({ shareFor: projectId })}><Share2 size={14} /> {sharedRole(projectId) ? 'Shared' : 'Share'}</button>
        <button className="btn" onClick={() => setSettingsOpen(true)}><Settings2 size={14} /> Project settings</button>
      </div>

      <section>
        <div className="row"><h2 className="section-title grow">Chapters</h2>
          <button className="btn ghost sm" onClick={async () => { const r = await createChapter(projectId); go({ view: 'write', projectId, sceneId: r.sceneId }); }}><Plus size={14} /> Chapter</button>
        </div>
        <ol className="ov-chapters">
          {chapters.map((c, i) => {
            const sc = scenes.filter((s) => s.chapterId === c.id).sort((a, b) => a.order - b.order);
            const w = sc.reduce((a, s) => a + s.words, 0);
            const isOpen = !!open[c.id];
            return (
              <li key={c.id} className="ov-ch" onContextMenu={(e) => chapterMenu(e, c)}>
                <div className="ov-row">
                  <button className="icon-btn sm" aria-label={isOpen ? 'Hide scenes' : 'Show scenes'} aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [c.id]: !isOpen }))}><ChevronRight size={13} className={'chev' + (isOpen ? ' open' : '')} /></button>
                  <span className="muted num">{i + 1}</span>
                  {c.color && <span className="dot" style={{ background: c.color }} />}
                  <button className="ov-title" onClick={() => sc[0] && go({ view: 'write', projectId, sceneId: sc[0].id })}>
                    <span className="ellipsis">{c.title}</span>
                    {c.summary && <span className="muted small ellipsis">{c.summary}</span>}
                  </button>
                  <span className="status-dot" title={STATUS_LABEL[c.status]} style={{ background: STATUS_COLOR[c.status] }} />
                  <span className="muted small num-w">{fmtNum(w)}</span>
                  <button className="icon-btn sm ov-more" title="Chapter options" onClick={(e) => chapterMenu(e, c)}><MoreHorizontal size={14} /></button>
                </div>
                {isOpen && (
                  <ul className="ov-scenes">
                    {sc.map((s) => (
                      <li key={s.id}><button onClick={() => go({ view: 'write', projectId, sceneId: s.id })}>
                        <span className="status-dot" style={{ background: STATUS_COLOR[s.status] }} /><span className="grow ellipsis">{s.title}{s.summary ? <span className="muted"> — {s.summary}</span> : null}</span><span className="muted small">{fmtNum(s.words)}</span>
                      </button></li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </section>
      <p className="muted small">Last edited {timeAgo(p.updatedAt)} · started {new Date(p.createdAt).toLocaleDateString()}</p>
      {settings && <ProjectSettings projectId={projectId} onClose={() => setSettingsOpen(false)} />}
      {tlFor && (() => { const c = chapters.find((x) => x.id === tlFor); return c && (
        <Modal title={`“${c.title}” on the timeline`} onClose={() => setTlFor(null)}>
          <div className="pad"><TimelineBox projectId={projectId} kind="chapter" id={c.id} name={c.title} /></div>
        </Modal>
      ); })()}
    </div>
  );
}

function ProjectSettings({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const p = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const backups = useLiveQuery(() => db.backups.where('[projectId+createdAt]').between([projectId, 0], [projectId, Infinity]).reverse().limit(10).toArray(), [projectId]);
  const [tab, setTab] = useState<'details' | 'backups' | 'export'>('details');
  if (!p) return null;
  return (
    <Modal title="Project settings" wide onClose={onClose}>
      <div className="settings">
        <nav className="settings-nav">
          <button className={'nav-item' + (tab === 'details' ? ' active' : '')} onClick={() => setTab('details')}><Settings2 size={15} /> Goal & look</button>
          <button className={'nav-item' + (tab === 'backups' ? ' active' : '')} onClick={() => setTab('backups')}><History size={15} /> Backups</button>
          <button className={'nav-item' + (tab === 'export' ? ' active' : '')} onClick={() => setTab('export')}><Download size={15} /> Other exports</button>
        </nav>
        <div className="settings-body">
          {tab === 'details' && <>
            <h3>Goal</h3>
            <div className="fgrid">
              <label className="sfield"><span>Word target</span><input className="input" type="number" min={0} step={1000} value={p.goalWords || ''} placeholder="e.g. 80000" onChange={(e) => db.projects.update(p.id, { goalWords: Math.max(0, +e.target.value || 0) })} /></label>
              <label className="sfield"><span>Deadline</span><input className="input" type="date" value={p.deadline ?? ''} onChange={(e) => db.projects.update(p.id, { deadline: e.target.value || undefined })} /></label>
              <label className="sfield"><span>Author name</span><input className="input" value={p.author ?? ''} placeholder="For title pages" onChange={(e) => db.projects.update(p.id, { author: e.target.value })} /></label>
            </div>
            <h3>Cover</h3>
            <div className="row gap">
              <ImageBox image={p.coverImage} name={p.title} size={96} onChange={(v) => db.projects.update(p.id, { coverImage: v ?? undefined })} />
              <div className="col gap-s">
                <span className="muted small">Color (used when there's no cover picture)</span>
                <div className="row gap-s">{COLORS.map((c) => <button key={c} className={'swatch' + (p.color === c ? ' on' : '')} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => db.projects.update(p.id, { color: c })} />)}</div>
              </div>
            </div>
          </>}
          {tab === 'backups' && <>
            <h3>Backup file</h3>
            <p className="muted small">One file with everything in this project (text, characters, worldbuilding, maps, notes and attachments). Restore it on any device from Home → Restore backup.</p>
            <button className="btn primary" onClick={async () => { if (await exportBackupFile(projectId)) toast('Backup file saved'); }}><Download size={14} /> Save backup file</button>
            <h3>Automatic backups</h3>
            <p className="muted small">A copy is kept inside the app every few minutes while you write (last 20). Restoring makes a separate copy; nothing is overwritten.</p>
            <button className="btn sm" onClick={async () => { await autoBackup(projectId); toast('Backup created'); }}>Back up now</button>
            <div className="backup-list">
              {backups?.length === 0 && <p className="muted small">No automatic backups yet.</p>}
              {backups?.map((b) => (
                <div key={b.id} className="row gap-s backup-row">
                  <span className="grow">{new Date(b.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} <span className="muted small">· {timeAgo(b.createdAt)}</span></span>
                  <button className="btn ghost sm" onClick={async () => {
                    if (!(await confirmDialog('Restore this backup as a copy?', 'A new project named “… (restored)” will be created next to this one.', { ok: 'Restore copy' }))) return;
                    try {
                      const id = await importProject(JSON.parse(b.data));
                      toast('Restored as a new project'); onClose(); go({ view: 'project', projectId: id });
                    } catch (err) { toast('Could not restore this backup: ' + (err as Error).message); }
                  }}>Restore</button>
                </div>
              ))}
            </div>
          </>}
          {tab === 'export' && <>
            <h3>Story bible</h3>
            <p className="muted small">The manuscript itself is under <strong>Export</strong> on the overview. Here you can export your reference material as Markdown.</p>
            <div className="col gap-s">
              <button className="btn" onClick={() => exportAllEntitiesMarkdown(projectId, 'character')}>All characters (.md)</button>
              <button className="btn" onClick={() => exportAllEntitiesMarkdown(projectId, 'world')}>All worldbuilding (.md)</button>
              <button className="btn" onClick={() => exportAllEntitiesMarkdown(projectId, 'note')}>All notes (.md)</button>
            </div>
          </>}
        </div>
      </div>
    </Modal>
  );
}
