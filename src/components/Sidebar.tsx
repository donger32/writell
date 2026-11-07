import { usePhone } from '../phone';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import {
  Home, BookOpen, Star, Settings as Cog, HelpCircle, PanelLeftClose, PanelLeftOpen, Plus, ChevronRight,
  FileText, Pencil, Copy, Trash2, Search, LayoutGrid, MessagesSquare, Shield, Columns2, FolderOpen, Users, Globe, StickyNote, Network, HeartHandshake, GanttChart, BarChart3, Map as MapIcon, Pin, PinOff, ListChecks, Clock,
} from 'lucide-react';
import { orderedTools } from '../sidebarTools';
import { SyncBadge } from './AccountSettings';
import { useSocial } from '../social/api';
import { useSharedRoles } from '../sync/engine';
import { useUnread } from '../social/chat';
import { useOpenTasks } from './story/Tasks';
import { Avatar } from './story/common';
import { openEntity } from './story/links';
import { type Entity, db, createChapter, createScene, duplicateChapter, reorderChapters, moveScene, type Chapter, type Scene } from '../db';
import { deleteChapter, deleteScene } from '../trash';
import { toastTrashed } from './TrashView';
import { go, openProject, setNav, useNav, getRecentScenes, getRecentEntities } from '../nav';
import { setSettings, useSettings, togglePin, isPinned } from '../settings';
import { confirmDialog, openMenu, promptDialog, rowKeys, STATUS_COLOR, CHAPTER_COLORS } from './ui';
import { fmtNum } from '../util';

const COLLAPSE_KEY = 'inkwell.sidebar.sections';
function useCollapsed() {
  const [c, setC] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; } });
  const toggle = (k: string) => setC((p) => { const n = { ...p, [k]: !p[k] }; try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(n)); } catch { /* */ } return n; });
  return [c, toggle] as const;
}

function WsBtn({ label, icon: I, active, onClick, dot }: { label: string; icon: typeof Home; active?: boolean; onClick: () => void; dot?: boolean }) {
  return <button className={'ws-btn' + (active ? ' active' : '')} title={label} aria-label={label} aria-current={active ? 'page' : undefined} onClick={onClick}><I size={16} />{dot && <span className="ws-dot" />}</button>;
}

export function Sidebar() {
  const s = useSettings();
  const { route } = useNav();
  const projectId = 'projectId' in route ? route.projectId : route.view === 'statistics' && route.scope ? route.scope : null;
  const project = useLiveQuery(() => (projectId ? db.projects.get(projectId) : undefined), [projectId]);
  const [collapsed, toggle] = useCollapsed();
  const phone = usePhone();
  const social = useSocial();
  const roles = useSharedRoles();
  const sharedHere = !!(projectId && roles[projectId]);
  const unread = useUnread(sharedHere ? projectId : null);
  const staff = !!social.me?.staff;
  // phones always get the full menu (it slides in over the page)
  const icon = s.sidebarCollapsed && !phone;
  const trashCount = useLiveQuery(() => db.trash.count(), []);
  const openTasks = useOpenTasks(projectId);
  const counts = useLiveQuery(async () => {
    if (!projectId) return null;
    const ents = await db.entities.where('projectId').equals(projectId).toArray();
    return { character: ents.filter((e) => e.kind === 'character').length, world: ents.filter((e) => e.kind === 'world').length, inbox: ents.filter((e) => e.kind === 'note' && e.fields.inbox).length };
  }, [projectId]);

  // drag-to-resize
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: MouseEvent) => { if (dragging.current) setSettings({ sidebarWidth: Math.max(200, Math.min(480, e.clientX / s.uiScale)) }); };
    const up = () => { dragging.current = false; document.body.classList.remove('resizing'); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [s.uiScale]);

  const Item = ({ label, icon: I, active, onClick, badge, drag }: { label: string; icon: typeof Home; active?: boolean; onClick: () => void; badge?: string; drag?: React.HTMLAttributes<HTMLButtonElement> & { draggable?: boolean } }) => (
    <button className={'nav-item' + (active ? ' active' : '')} onClick={onClick} title={icon ? label : undefined} aria-label={icon ? label : undefined} aria-current={active ? 'page' : undefined} {...drag}>
      <I size={16} /> {!icon && <span className="grow">{label}</span>}{!icon && badge && <span className="badge">{badge}</span>}
    </button>
  );

  return (
    <aside className={'sidebar' + (icon ? ' icon-only' : '')} aria-label="Navigation">
      <div className="sb-top">
        {!icon && <div className="brand">Writell</div>}
        <button className="icon-btn" title="Search & commands (Ctrl+K)" onClick={() => setNav({ paletteOpen: true })}><Search size={16} /></button>
        {!phone && <button className="icon-btn" title={icon ? 'Expand sidebar' : 'Compact sidebar'} onClick={() => setSettings({ sidebarCollapsed: !icon })}>
          {icon ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>}
      </div>

      <div className="sb-scroll">
        {project && !icon ? (
          // inside a project the workspace shrinks to one row of icons
          <div className="sb-ws-row" role="navigation" aria-label="Workspace">
            <WsBtn label="Home" icon={Home} active={route.view === 'home'} onClick={() => go({ view: 'home' })} />
            <WsBtn label="All projects" icon={LayoutGrid} active={route.view === 'projects'} onClick={() => go({ view: 'projects' })} />
            {s.showStats && <WsBtn label="Statistics" icon={BarChart3} active={route.view === 'statistics'} onClick={() => go({ view: 'statistics', scope: project.id })} />}
            <WsBtn label={social.incoming.length ? `Friends (${social.incoming.length} requests)` : 'Friends'} icon={Users} active={route.view === 'friends'} onClick={() => go({ view: 'friends' })} dot={!!social.incoming.length} />
            <WsBtn label={trashCount ? `Trash (${trashCount})` : 'Trash'} icon={Trash2} active={route.view === 'trash'} onClick={() => go({ view: 'trash' })} dot={!!trashCount} />
            {staff && <WsBtn label="Admin" icon={Shield} active={route.view === 'admin'} onClick={() => go({ view: 'admin' })} />}
          </div>
        ) : (
          <Section id="workspace" label="Workspace" collapsed={collapsed} toggle={toggle} icon={icon}>
            <Item label="Home" icon={Home} active={route.view === 'home'} onClick={() => go({ view: 'home' })} />
            <Item label="Projects" icon={LayoutGrid} active={route.view === 'projects'} onClick={() => go({ view: 'projects' })} />
            {s.showStats && <Item label="Statistics" icon={BarChart3} active={route.view === 'statistics'} onClick={() => go({ view: 'statistics', ...(project ? { scope: project.id } : {}) })} />}
            <Item label="Friends" icon={Users} active={route.view === 'friends'} onClick={() => go({ view: 'friends' })} badge={social.incoming.length ? String(social.incoming.length) : undefined} />
            <Item label="Trash" icon={Trash2} active={route.view === 'trash'} onClick={() => go({ view: 'trash' })} badge={trashCount ? String(trashCount) : undefined} />
            {staff && <Item label="Admin" icon={Shield} active={route.view === 'admin'} onClick={() => go({ view: 'admin' })} />}
          </Section>
        )}

        {project && (
          <Section id="project" label={project.title} collapsed={collapsed} toggle={toggle} icon={icon}
            action={!icon ? <span className="row">
              <button className={'icon-btn sm' + (route.view === 'search' ? ' on' : '')} title="Search this project (Ctrl+Shift+F)" onClick={() => go({ view: 'search', projectId: project.id })}><Search size={14} /></button>
              <button className="icon-btn sm" title="Switch project" onClick={(e) => switchProjectMenu(e)}><FolderOpen size={14} /></button>
            </span> : undefined}>
            {sharedHere && <Item label="Chat" icon={MessagesSquare} active={route.view === 'chat'} onClick={() => go({ view: 'chat', projectId: project.id })} badge={unread ? String(unread) : undefined} />}
            {orderedTools(s.sidebarTools).filter((t) => t.visible && (t.id !== 'statistics' || s.showStats)).map((t) => {
              const pid = project.id;
              const def: Record<string, { icon: typeof Home; view: string; badge?: string; go: () => void }> = {
                overview: { icon: BookOpen, view: 'project', go: () => go({ view: 'project', projectId: pid }) },
                characters: { icon: Users, view: 'characters', badge: counts?.character ? String(counts.character) : undefined, go: () => go({ view: 'characters', projectId: pid }) },
                world: { icon: Globe, view: 'world', badge: counts?.world ? String(counts.world) : undefined, go: () => go({ view: 'world', projectId: pid }) },
                tasks: { icon: ListChecks, view: 'tasks', badge: openTasks ? String(openTasks) : undefined, go: () => go({ view: 'tasks', projectId: pid }) },
                notes: { icon: StickyNote, view: 'notes', badge: counts?.inbox ? `${counts.inbox} new` : undefined, go: () => go({ view: 'notes', projectId: pid }) },
                maps: { icon: MapIcon, view: 'maps', go: () => go({ view: 'maps', projectId: pid }) },
                family: { icon: Network, view: 'family', go: () => go({ view: 'family', projectId: pid }) },
                relationships: { icon: HeartHandshake, view: 'relationships', go: () => go({ view: 'relationships', projectId: pid }) },
                timelines: { icon: GanttChart, view: 'timelines', go: () => go({ view: 'timelines', projectId: pid }) },
                statistics: { icon: BarChart3, view: 'statistics', go: () => go({ view: 'statistics', scope: pid }) },
                search: { icon: Search, view: 'search', go: () => go({ view: 'search', projectId: pid }) },
              };
              const d = def[t.id];
              const dragProps = {
                draggable: true,
                className: undefined,
                onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData('text/x-inkwell-tool', t.id); e.dataTransfer.effectAllowed = 'move'; },
                onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('text/x-inkwell-tool')) e.preventDefault(); },
                onDrop: (e: React.DragEvent) => {
                  const from = e.dataTransfer.getData('text/x-inkwell-tool'); if (!from || from === t.id) return;
                  const list = orderedTools(s.sidebarTools).map((x) => ({ id: x.id, visible: x.visible }));
                  const item = list.splice(list.findIndex((x) => x.id === from), 1)[0];
                  list.splice(list.findIndex((x) => x.id === t.id), 0, item);
                  setSettings({ sidebarTools: list });
                },
              };
              delete (dragProps as { className?: string }).className;
              return <Item key={t.id} label={t.label} icon={d.icon} active={route.view === d.view && (t.id !== 'statistics' || ('scope' in route && route.scope === pid))} onClick={d.go} badge={d.badge} drag={dragProps} />;
            })}
            {!icon && <PinnedItems projectId={project.id} />}
            {!icon && <ProjectFavorites projectId={project.id} />}
            {!icon && s.sbRecentChars && <RecentCharacters projectId={project.id} />}
            {!icon && <Manuscript projectId={project.id} />}
          </Section>
        )}

        {!icon && s.sbRecentScenes && <RecentScenes />}
      </div>

      <div className="sb-bottom">
        <SyncBadge iconOnly={icon} onOpen={() => setNav({ settingsOpen: true, settingsTab: 'account' })} />
        <Item label="Settings" icon={Cog} onClick={() => setNav({ settingsOpen: true })} />
        <Item label="Help & shortcuts" icon={HelpCircle} onClick={() => setNav({ helpOpen: true })} />
      </div>
      {!icon && <div className="resizer" onMouseDown={() => { dragging.current = true; document.body.classList.add('resizing'); }} onDoubleClick={() => setSettings({ sidebarWidth: 260 })} />}
    </aside>
  );
}

async function switchProjectMenu(e: React.MouseEvent) {
  const ev = { clientX: e.clientX, clientY: e.clientY, preventDefault() {}, stopPropagation() {} };
  const projects = await db.projects.orderBy('openedAt').reverse().filter((p) => !p.archived).limit(10).toArray();
  openMenu(ev, projects.map((p) => ({ label: p.title, icon: <BookOpen size={14} />, onClick: () => openProject(p.id) })));
}

function Section({ id, label, children, collapsed, toggle, icon, action }: { id: string; label: string; children: React.ReactNode; collapsed: Record<string, boolean>; toggle: (k: string) => void; icon: boolean; action?: React.ReactNode }) {
  const closed = collapsed[id] && !icon;
  return (
    <div className="sb-section">
      {!icon ? (
        <div className="sb-label">
          <button onClick={() => toggle(id)}><ChevronRight size={12} className={'chev' + (closed ? '' : ' open')} /> <span>{label}</span></button>
          {action}
        </div>
      ) : <div className="sb-divider" />}
      {!closed && children}
    </div>
  );
}

function PinnedItems({ projectId }: { projectId: string }) {
  const s = useSettings();
  const { route } = useNav();
  const pins = s.pins.filter((p) => p.projectId === projectId);
  const data = useLiveQuery(async () => ({
    scenes: await db.scenes.bulkGet(pins.filter((p) => p.kind === 'scene').map((p) => p.id)),
    ents: await db.entities.bulkGet(pins.filter((p) => p.kind === 'entity').map((p) => p.id)),
    chapters: await db.chapters.where('projectId').equals(projectId).toArray(),
  }), [pins.map((p) => p.id).join()]);
  if (!pins.length || !data) return null;
  const items = pins.map((p) => p.kind === 'scene' ? { p, s: data.scenes.find((x) => x?.id === p.id) } : { p, e: data.ents.find((x) => x?.id === p.id) }).filter((x) => ('s' in x ? x.s : x.e));
  if (!items.length) return null;
  const unpinMenu = (e: React.MouseEvent, p: (typeof pins)[number]) => openMenu(e, [{ label: 'Unpin from sidebar', icon: <PinOff size={14} />, onClick: () => togglePin(p) }]);
  return (
    <div className="sb-pins" aria-label="Pinned">
      <div className="sb-mini-label"><Pin size={10} /> Pinned</div>
      {items.map((x) => 's' in x && x.s ? (
        <button key={x.p.id} className={'nav-item small' + (route.view === 'write' && route.sceneId === x.s.id ? ' active' : '')} onClick={() => go({ view: 'write', projectId, sceneId: x.s!.id })} onContextMenu={(e) => unpinMenu(e, x.p)}>
          <FileText size={13} /><span className="grow ellipsis">{data.chapters.find((c) => c.id === x.s!.chapterId)?.title} · {x.s.title}</span>
        </button>
      ) : 'e' in x && x.e ? (
        <button key={x.p.id} className={'nav-item small' + ('entityId' in route && route.entityId === x.e.id ? ' active' : '')} onClick={() => openEntity(x.e!)} onContextMenu={(e) => unpinMenu(e, x.p)}>
          <Avatar name={x.e.name} color={x.e.fields.color as string | undefined} image={x.e.fields.image as string | undefined} size={16} round={x.e.kind === 'character'} /><span className="grow ellipsis">{x.e.name || 'Untitled'}</span>
        </button>
      ) : null)}
    </div>
  );
}

function RecentCharacters({ projectId }: { projectId: string }) {
  const { route } = useNav();
  const recent = useLiveQuery(async () => (await db.entities.bulkGet(getRecentEntities())).filter((e) => e && e.projectId === projectId && e.kind === 'character').slice(0, 4) as Entity[], [route, projectId]);
  if (!recent?.length) return null;
  return (
    <div className="sb-pins">
      <div className="sb-mini-label"><Clock size={10} /> Recent characters</div>
      {recent.map((e) => (
        <button key={e.id} className={'nav-item small' + ('entityId' in route && route.entityId === e.id ? ' active' : '')} onClick={() => openEntity(e)}>
          <Avatar name={e.name} color={e.fields.color as string | undefined} image={e.fields.image as string | undefined} size={16} /><span className="grow ellipsis">{e.name}</span>
        </button>
      ))}
    </div>
  );
}

function RecentScenes() {
  const { route } = useNav();
  const recent = useLiveQuery(async () => (await db.scenes.bulkGet(getRecentScenes().slice(0, 5))).filter(Boolean) as Scene[], [route]);
  const chapters = useLiveQuery(() => db.chapters.bulkGet((recent ?? []).map((s) => s.chapterId)), [recent]);
  const [collapsed, toggle] = useCollapsed();
  if (!recent?.length) return null;
  return (
    <Section id="recent" label="Recently opened" collapsed={collapsed} toggle={toggle} icon={false}>
      {recent.map((sc, i) => (
        <button key={sc.id} className={'nav-item small' + (route.view === 'write' && route.sceneId === sc.id ? ' active' : '')} onClick={() => go({ view: 'write', projectId: sc.projectId, sceneId: sc.id })}>
          <Clock size={13} /><span className="grow ellipsis">{chapters?.[i]?.title} · {sc.title}</span>
        </button>
      ))}
    </Section>
  );
}

function ProjectFavorites({ projectId }: { projectId: string }) {
  const favs = useLiveQuery(() => db.entities.where('projectId').equals(projectId).filter((e) => e.favorite && e.kind !== 'note').toArray(), [projectId]);
  const { route } = useNav();
  if (!favs?.length) return null;
  const activeId = 'entityId' in route ? route.entityId : undefined;
  return (
    <div className="sb-favs">
      {favs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })).map((e) => (
        <button key={e.id} className={'nav-item small' + (activeId === e.id ? ' active' : '')} onClick={() => openEntity(e)} title={e.name}>
          <Avatar name={e.name} color={e.fields.color as string | undefined} image={e.fields.image as string | undefined} size={16} round={e.kind === 'character'} />
          <span className="grow ellipsis">{e.name}</span><Star size={10} className="accent" fill="currentColor" />
        </button>
      ))}
    </div>
  );
}


/* ---------------- Manuscript tree with drag & drop ---------------- */

type Drag = { type: 'chapter' | 'scene'; id: string } | null;

function Manuscript({ projectId }: { projectId: string }) {
  const { route } = useNav();
  const chapters = useLiveQuery(() => db.chapters.where('[projectId+order]').between([projectId, -Infinity], [projectId, Infinity]).toArray(), [projectId]);
  const scenes = useLiveQuery(() => db.scenes.where('projectId').equals(projectId).toArray(), [projectId]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string | null>(null);
  const activeScene = route.view === 'write' ? route.sceneId : null;

  if (!chapters || !scenes) return null;
  const byChapter = (id: string) => scenes.filter((s) => s.chapterId === id).sort((a, b) => a.order - b.order);
  const isOpen = (ch: Chapter) => open[ch.id] ?? (byChapter(ch.id).some((s) => s.id === activeScene) || chapters.length <= 3);

  const dropOnChapter = async (target: Chapter, e: React.DragEvent) => {
    e.preventDefault(); setOver(null);
    if (!drag) return;
    if (drag.type === 'chapter' && drag.id !== target.id) {
      const ids = chapters.map((c) => c.id).filter((id) => id !== drag.id);
      ids.splice(ids.indexOf(target.id) + (chapters.findIndex((c) => c.id === drag.id) < chapters.indexOf(target) ? 1 : 0), 0, drag.id);
      await reorderChapters(ids);
    } else if (drag.type === 'scene') {
      await moveScene(drag.id, target.id, byChapter(target.id).length);
      setOpen((o) => ({ ...o, [target.id]: true }));
    }
    setDrag(null);
  };
  const dropOnScene = async (target: Scene, e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(null);
    if (drag?.type !== 'scene' || drag.id === target.id) return setDrag(null);
    const list = byChapter(target.chapterId).filter((s) => s.id !== drag.id);
    const idx = list.findIndex((s) => s.id === target.id);
    await moveScene(drag.id, target.chapterId, idx);
    setDrag(null);
  };

  const chapterMenu = (e: React.MouseEvent, ch: Chapter, i: number) => openMenu(e, [
    { label: 'New scene', icon: <Plus size={14} />, onClick: async () => { const id = await createScene(ch.id); setOpen((o) => ({ ...o, [ch.id]: true })); go({ view: 'write', projectId, sceneId: id }); } },
    { label: 'Rename', icon: <Pencil size={14} />, onClick: async () => { const t = await promptDialog('Rename chapter', ch.title); if (t) db.chapters.update(ch.id, { title: t, updatedAt: Date.now() }); } },
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => duplicateChapter(ch.id) },
    { label: 'Move up', onClick: () => { if (i > 0) { const ids = chapters.map((c) => c.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; reorderChapters(ids); } } },
    { label: 'Move down', onClick: () => { if (i < chapters.length - 1) { const ids = chapters.map((c) => c.id); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; reorderChapters(ids); } } },
    { divider: true, label: '', onClick: () => {} },
    ...CHAPTER_COLORS.map((c, k) => ({ label: ['No color', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink'][k], icon: <span className="dot" style={{ background: c || 'transparent', border: c ? 'none' : '1px solid var(--muted)' }} />, onClick: () => db.chapters.update(ch.id, { color: c }) })),
    { divider: true, label: '', onClick: () => {} },
    { label: 'Delete chapter', danger: true, icon: <Trash2 size={14} />, onClick: async () => {
      const n = byChapter(ch.id).reduce((a, s) => a + s.words, 0);
      if (await confirmDialog(`Delete “${ch.title}”?`, `Its ${byChapter(ch.id).length} scene(s) and ${fmtNum(n)} words go to the Trash, where you can restore them.`, { danger: true, ok: 'Move to Trash' })) {
        if (byChapter(ch.id).some((s) => s.id === activeScene)) go({ view: 'project', projectId });
        toastTrashed(ch.title, await deleteChapter(ch.id));
      }
    } },
  ]);

  const sceneMenu = (e: React.MouseEvent, sc: Scene) => openMenu(e, [
    { label: 'Open in split view', icon: <Columns2 size={14} />, onClick: () => { if (route.view === 'write' && route.sceneId !== sc.id) go({ ...route, splitSceneId: sc.id }); else go({ view: 'write', projectId, sceneId: sc.id }); } },
    { label: isPinned({ kind: 'scene', id: sc.id }) ? 'Unpin from sidebar' : 'Pin to sidebar', icon: <Pin size={14} />, onClick: () => togglePin({ projectId, kind: 'scene', id: sc.id }) },
    { label: 'Rename', icon: <Pencil size={14} />, onClick: async () => { const t = await promptDialog('Rename scene', sc.title); if (t) db.scenes.update(sc.id, { title: t }); } },
    { label: 'Delete scene', danger: true, icon: <Trash2 size={14} />, onClick: async () => {
      if (route.view === 'write' && (route.sceneId === sc.id || route.splitSceneId === sc.id)) go({ view: 'project', projectId });
      toastTrashed(sc.title, await deleteScene(sc.id));
    } },
  ]);

  return (
    <div className="tree" role="tree" aria-label="Manuscript">
      <div className="tree-head">
        <span>Manuscript</span>
        <button className="icon-btn sm" title="New chapter" onClick={async () => { const r = await createChapter(projectId); go({ view: 'write', projectId, sceneId: r.sceneId }); }}><Plus size={14} /></button>
      </div>
      {chapters.map((ch, i) => {
        const sc = byChapter(ch.id);
        const words = sc.reduce((a, s) => a + s.words, 0);
        const o = isOpen(ch);
        return (
          <div key={ch.id} className={'tree-ch' + (over === ch.id ? ' drop' : '')}
            onDragOver={(e) => { e.preventDefault(); setOver(ch.id); }} onDragLeave={() => setOver(null)} onDrop={(e) => dropOnChapter(ch, e)}>
            <div className="tree-row ch" draggable onDragStart={() => setDrag({ type: 'chapter', id: ch.id })} onDragEnd={() => { setDrag(null); setOver(null); }}
              role="treeitem" aria-expanded={o} tabIndex={0}
              onKeyDown={rowKeys(() => setOpen((x) => ({ ...x, [ch.id]: !o })), (el) => { const r = el.getBoundingClientRect(); chapterMenu({ clientX: r.left + 24, clientY: r.bottom, preventDefault() {}, stopPropagation() {} } as unknown as React.MouseEvent, ch, i); })}
              onClick={() => setOpen((x) => ({ ...x, [ch.id]: !o }))} onContextMenu={(e) => chapterMenu(e, ch, i)}>
              <ChevronRight size={12} className={'chev' + (o ? ' open' : '')} />
              {ch.color && <span className="dot" style={{ background: ch.color }} />}
              <span className="grow ellipsis">{ch.title}</span>
              <span className="count">{words ? fmtNum(words) : ''}</span>
            </div>
            {o && sc.map((s) => (
              <div key={s.id} className={'tree-row sc' + (activeScene === s.id ? ' active' : '') + (over === s.id ? ' drop' : '')} draggable
                onDragStart={(e) => { e.stopPropagation(); setDrag({ type: 'scene', id: s.id }); }} onDragEnd={() => { setDrag(null); setOver(null); }}
                onDragOver={(e) => { if (drag?.type === 'scene') { e.preventDefault(); e.stopPropagation(); setOver(s.id); } }}
                onDrop={(e) => dropOnScene(s, e)}
                role="treeitem" tabIndex={0} aria-current={activeScene === s.id ? 'page' : undefined}
                onKeyDown={rowKeys(() => go({ view: 'write', projectId, sceneId: s.id }), (el) => { const r = el.getBoundingClientRect(); sceneMenu({ clientX: r.left + 24, clientY: r.bottom, preventDefault() {}, stopPropagation() {} } as unknown as React.MouseEvent, s); })}
                onClick={() => go({ view: 'write', projectId, sceneId: s.id })} onContextMenu={(e) => sceneMenu(e, s)}>
                <FileText size={13} />
                <span className="grow ellipsis">{s.title}</span>
                <span className="status-dot" title={s.status} style={{ background: STATUS_COLOR[s.status] }} />
              </div>
            ))}
            {o && <button className="tree-add" onClick={async () => { const id = await createScene(ch.id); go({ view: 'write', projectId, sceneId: id }); }}><Plus size={12} /> Scene</button>}
          </div>
        );
      })}
    </div>
  );
}
