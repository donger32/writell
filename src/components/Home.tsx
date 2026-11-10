import { editDescription } from './DescPop';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Star, MoreHorizontal, Upload, FileUp, Pencil, Copy, Archive, Trash2, ArchiveRestore, Share2, Users, LogOut, Link2, AlignLeft } from 'lucide-react';
import { sharedRole, useSharedRoles } from '../sync/engine';
import { leaveProject, stopSharing, ROLE_LABEL } from '../social/share';
import { db, duplicateProject, type Project } from '../db';
import { deleteProject } from '../trash';
import { toastTrashed } from './TrashView';
import { go, openProject, getRecentScenes, setNav } from '../nav';
import { fmtNum, timeAgo } from '../util';
import { confirmDialog, openMenu, promptDialog, toast } from './ui';
import { importBackupFile, importManuscript } from '../exporting';
import { importDocx } from '../manuscript';

function useProjectWords() {
  return useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.scenes.each((s) => m.set(s.projectId, (m.get(s.projectId) ?? 0) + s.words));
    return m;
  }, []);
}

export function newProjectFlow() {
  setNav({ newProject: true });
}

async function runImport(kind: 'backup' | 'manuscript' | 'docx') {
  try {
    const id = kind === 'backup' ? await importBackupFile() : kind === 'docx' ? await importDocx() : await importManuscript();
    if (id) { toast('Imported'); go({ view: 'project', projectId: id }); }
  } catch (e) { toast((e as Error).message); }
}

export function projectMenu(e: React.MouseEvent, p: Project) {
  openMenu(e, [
    { label: 'Rename', icon: <Pencil size={14} />, onClick: async () => { const t = await promptDialog('Rename project', p.title); if (t) db.projects.update(p.id, { title: t }); } },
    { label: p.description?.trim() ? 'Edit description…' : 'Add a description…', icon: <AlignLeft size={14} />, onClick: () => editDescription(`Description of “${p.title}”`, p.description ?? '', (v) => db.projects.update(p.id, { description: v })) },
    { label: sharedRole(p.id) ? 'Sharing…' : 'Share…', icon: <Share2 size={14} />, onClick: () => setNav({ shareFor: p.id }) },
    { label: p.favorite ? 'Remove from favorites' : 'Add to favorites', icon: <Star size={14} />, onClick: () => db.projects.update(p.id, { favorite: !p.favorite }) },
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: async () => { await duplicateProject(p.id); toast('Project duplicated'); } },
    { label: p.archived ? 'Unarchive' : 'Archive', icon: p.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />, onClick: () => db.projects.update(p.id, { archived: !p.archived }) },
    { divider: true, label: '', onClick: () => {} },
    ...(sharedRole(p.id) && sharedRole(p.id) !== 'owner' ? [{ label: 'Leave project…', danger: true, icon: <LogOut size={14} />, onClick: async () => {
      if (await confirmDialog(`Leave “${p.title}”?`, 'It disappears from your devices. The owner can add you again.', { danger: true, ok: 'Leave project' })) { go({ view: 'home' }); try { await leaveProject(p.id); toast('You left the project'); } catch (e) { toast((e as Error).message); } }
    } }] : [{ label: 'Delete project…', danger: true, icon: <Trash2 size={14} />, onClick: async () => {
      if (sharedRole(p.id) === 'owner') {
        if (!(await confirmDialog(`Delete “${p.title}” for everyone?`, 'It’s shared: everyone loses access, then it goes to your Trash.', { danger: true, ok: 'Delete for everyone' }))) return;
        try { await stopSharing(p.id); } catch (e) { toast((e as Error).message); return; }
        go({ view: 'home' }); toastTrashed(p.title, await deleteProject(p.id)); return;
      }
      const ok = await confirmDialog(`Delete “${p.title}”?`, 'The whole project goes to the Trash. You can restore it from there until you empty the trash.', { danger: true, ok: 'Move to Trash' });
      if (ok) { go({ view: 'home' }); toastTrashed(p.title, await deleteProject(p.id)); }
    } }]),
  ]);
}

function ProjectCard({ p, words }: { p: Project; words: number }) {
  const pct = p.goalWords ? Math.min(100, Math.round((words / p.goalWords) * 100)) : null;
  return (
    <div className="card project-card" onClick={() => openProject(p.id)} onContextMenu={(e) => projectMenu(e, p)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openProject(p.id)}>
      <div className="cover" style={p.coverImage ? { backgroundImage: `linear-gradient(transparent 40%, rgba(0,0,0,.55)), url(${p.coverImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: `linear-gradient(135deg, ${p.color}, color-mix(in srgb, ${p.color} 35%, var(--panel)))` }}>
        <span className="cover-title">{p.title}</span>
      </div>
      <div className="card-body">
        <div className="row">
          <strong className="grow ellipsis">{p.title}</strong>
          {sharedRole(p.id) && <span className="shared-badge" title={sharedRole(p.id) === 'owner' ? 'You share this project' : `Shared with you · ${ROLE_LABEL[sharedRole(p.id)!]}`}><Users size={12} />{sharedRole(p.id) !== 'owner' ? ` ${ROLE_LABEL[sharedRole(p.id)!]}` : ''}</span>}
          <button className={'icon-btn sm fav-btn' + (p.favorite ? ' on' : '')} title={p.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-label={p.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={!!p.favorite} onClick={(e) => { e.stopPropagation(); db.projects.update(p.id, { favorite: !p.favorite }); }}>
            <Star size={14} fill={p.favorite ? 'currentColor' : 'none'} />
          </button>
          <button className="icon-btn sm" onClick={(e) => { e.stopPropagation(); projectMenu(e, p); }}><MoreHorizontal size={14} /></button>
        </div>
        {!!p.description?.trim() && <p className="card-desc" title={p.description}>{p.description}</p>}
        <div className="muted small">{fmtNum(words)} words · edited {timeAgo(p.updatedAt)}</div>
        {pct !== null && <div className="progress" title={`${pct}% of ${fmtNum(p.goalWords)}`}><div style={{ width: pct + '%' }} /></div>}
      </div>
    </div>
  );
}

export function HomeView() {
  const roles = useSharedRoles();
  const projects = useLiveQuery(() => db.projects.orderBy('openedAt').reverse().filter((p) => !p.archived).toArray(), []);
  const words = useProjectWords();
  const recent = useLiveQuery(async () => {
    const sc = (await db.scenes.bulkGet(getRecentScenes().slice(0, 6))).filter(Boolean);
    const chs = await db.chapters.bulkGet(sc.map((s) => s!.chapterId));
    const ps = await db.projects.bulkGet(sc.map((s) => s!.projectId));
    return sc.map((s, i) => ({ s: s!, ch: chs[i], p: ps[i] }));
  }, []);
  const today = useLiveQuery(async () => {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return (await db.activity.where('day').equals(key).toArray()).reduce((a, x) => a + x.wordsAdded, 0);
  }, []);
  if (!projects) return null;
  const total = [...(words?.values() ?? [])].reduce((a, b) => a + b, 0);
  const hour = new Date().getHours();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}</h1>
          <p className="muted">{projects.length ? `${projects.length} project${projects.length > 1 ? 's' : ''} · ${fmtNum(total)} words in total${today ? ` · ${fmtNum(today)} written today` : ''}` : 'Your writing lives on this device. Start a project to begin.'}</p>
        </div>
        <div className="row gap-s">
          <button className="btn" onClick={(e) => openMenu(e, [
            { label: 'Word document (.docx)', onClick: () => runImport('docx') },
            { label: 'Markdown or text (.md, .txt)', onClick: () => runImport('manuscript') },
          ])}><FileUp size={15} /> Import manuscript</button>
          <button className="btn" onClick={() => runImport('backup')}><Upload size={15} /> Restore backup</button>
          <button className="btn" onClick={() => setNav({ joinLink: '' })} title="Join a project a friend shared with you"><Link2 size={15} /> Join with a link</button>
          <button className="btn primary" onClick={newProjectFlow}><Plus size={15} /> New project</button>
        </div>
      </header>

      {recent && recent.length > 0 && (
        <section>
          <h2 className="section-title">Continue writing</h2>
          <div className="recent-row">
            {recent.map(({ s, ch, p }) => (
              <button key={s.id} className="card recent" onClick={() => go({ view: 'write', projectId: s.projectId, sceneId: s.id })}>
                <span className="muted small ellipsis">{p?.title}</span>
                <strong className="ellipsis">{ch?.title} · {s.title}</strong>
                <span className="muted small">{fmtNum(s.words)} words · {timeAgo(s.updatedAt)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {projects.some((p) => p.favorite) && (
        <section>
          <h2 className="section-title">Favorites</h2>
          <div className="grid">{projects.filter((p) => p.favorite).map((p) => <ProjectCard key={p.id} p={p} words={words?.get(p.id) ?? 0} />)}</div>
        </section>
      )}

      {projects.some((p) => roles[p.id] && roles[p.id] !== 'owner') && (
        <section>
          <h2 className="section-title">Shared with me</h2>
          <div className="grid">{projects.filter((p) => roles[p.id] && roles[p.id] !== 'owner').map((p) => <ProjectCard key={p.id} p={p} words={words?.get(p.id) ?? 0} />)}</div>
        </section>
      )}

      <section>
        <h2 className="section-title">{projects.some((p) => p.favorite) ? 'All projects' : 'Projects'}</h2>
        {projects.length === 0 ? (
          <div className="empty card">
            <h3>No projects yet</h3>
            <p className="muted">Create a project from a template, or import an existing manuscript (Word, Markdown or text). Headings become chapters.</p>
            <button className="btn primary" onClick={newProjectFlow}><Plus size={15} /> New project</button>
          </div>
        ) : (
          <div className="grid">{projects.filter((p) => !roles[p.id] || roles[p.id] === 'owner').map((p) => <ProjectCard key={p.id} p={p} words={words?.get(p.id) ?? 0} />)}</div>
        )}
      </section>
    </div>
  );
}

export function ProjectsView({ filter = 'all' }: { filter?: 'all' | 'favorites' | 'archived' }) {
  // last opened first
  const projects = useLiveQuery(() => db.projects.orderBy('openedAt').reverse().toArray(), []);
  const words = useProjectWords();
  if (!projects) return null;
  const list = projects.filter((p) => (filter === 'archived' ? p.archived : !p.archived && (filter !== 'favorites' || p.favorite)));
  const count = (f: typeof filter) => projects.filter((p) => (f === 'archived' ? p.archived : !p.archived && (f !== 'favorites' || p.favorite))).length;
  return (
    <div className="page">
      <header className="page-head">
        <h1 className="grow">Projects</h1>
        <button className="btn primary" onClick={newProjectFlow}><Plus size={15} /> New project</button>
      </header>
      <div className="seg projects-tabs" role="tablist" aria-label="Show">
        {(['all', 'favorites', 'archived'] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => go({ view: 'projects', filter: f })}>
            {{ all: 'All', favorites: 'Favorites', archived: 'Archived' }[f]}{count(f) ? <span className="seg-count">{count(f)}</span> : null}
          </button>
        ))}
      </div>
      {list.length === 0 ? <p className="muted">{filter === 'favorites' ? 'Click the ☆ on a project to add it to your favorites.' : filter === 'archived' ? 'Archived projects are hidden from Home but kept safe here.' : 'No projects yet.'}</p>
        : <div className="grid">{list.map((p) => <ProjectCard key={p.id} p={p} words={words?.get(p.id) ?? 0} />)}</div>}
    </div>
  );
}
