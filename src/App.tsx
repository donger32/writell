import { useEffect, useState } from 'react';
import { Menu, Search } from 'lucide-react';
import { UpdateBanner } from './components/UpdateBanner';
import { FriendsView } from './components/FriendsView';
import { JoinDialog, ShareDialog, takeInviteFromAddress } from './components/ShareDialog';
import { useSharedRoles, useSyncStatus } from './sync/engine';
import { Eye } from 'lucide-react';
import { toast } from './components/ui';
import { Sidebar } from './components/Sidebar';
import { HomeView, ProjectsView } from './components/Home';
import { ProjectOverview } from './components/ProjectOverview';
import { EditorPane } from './components/EditorPane';
import { SettingsModal } from './components/SettingsModal';
import { CommandPalette } from './components/CommandPalette';
import { DialogHost, MenuHost, Modal, ToastHost } from './components/ui';
import { applySettingsToDOM, useSettings } from './settings';
import { go, setNav, useNav, getNav } from './nav';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { TabBar } from './components/TabBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CharactersView } from './components/story/Characters';
import { WorldView } from './components/story/World';
import { NotesView, QuickNote } from './components/story/Notes';
import { SearchView } from './components/story/SearchView';
import { closeTab } from './nav';
import { matches, combo } from './shortcuts';
import { FamilyTreesView } from './components/visual/FamilyTree';
import { RelationshipMapView } from './components/visual/RelationshipMap';
import { TimelinesView } from './components/visual/Timelines';
import { StatsView } from './components/StatsView';
import { TrashView } from './components/TrashView';
import { TasksView } from './components/story/Tasks';
import { MapsView } from './components/maps/Maps';
import { NewProjectDialog } from './components/NewProjectDialog';
import { ExportDialog } from './components/ExportDialog';

const PHONE_TITLES: Record<string, string> = {
  home: 'Writell', projects: 'Projects', project: 'Overview', write: 'Write', characters: 'Character', world: 'Worldbuilding', notes: 'Notes',
  search: 'Search', statistics: 'Statistics', trash: 'Trash', friends: 'Friends', tasks: 'Tasks', family: 'Tree', maps: 'Map', relationships: 'Relation', timelines: 'Timeline', revision: 'Revision',
};

export default function App() {
  const s = useSettings();
  const nav = useNav();
  const { route } = nav;

  useEffect(() => applySettingsToDOM(s), [s]);
  // shared projects: invite links, view-only banner, arrivals/removals
  const sync = useSyncStatus();
  const roles = useSharedRoles();
  useEffect(() => {
    const check = () => { const link = takeInviteFromAddress(); if (link && getNav().joinLink === null) setNav({ joinLink: link }); };
    check(); window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [sync.phase]);
  useEffect(() => {
    const added = async (e: Event) => { const p = await db.projects.get((e as CustomEvent).detail as string); toast(`“${p?.title ?? 'A project'}” was shared with you`); };
    const removed = (e: Event) => toast(`You no longer have access to “${((e as CustomEvent).detail as { title: string }).title}”`);
    window.addEventListener('writell:shared-added', added); window.addEventListener('writell:shared-removed', removed);
    return () => { window.removeEventListener('writell:shared-added', added); window.removeEventListener('writell:shared-removed', removed); };
  }, []);
  const viewRole = 'projectId' in route ? roles[route.projectId] : undefined;
  const readOnly = viewRole === 'viewer' || viewRole === 'commenter';

  // phones: the sidebar slides in over the page and closes when you pick something
  const [sbOpen, setSbOpen] = useState(false);
  const routeKey = JSON.stringify(route);
  useEffect(() => setSbOpen(false), [routeKey, nav.settingsOpen, nav.paletteOpen, nav.helpOpen, nav.newProject, nav.exportFor, nav.quickNote]);
  // tapping any item in the open menu closes it, even the page you're already on
  useEffect(() => {
    if (!sbOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.sidebar') && t.closest('.nav-item, .tree-row, .ws-btn') && !t.closest('.sb-label, .tree-toggle, [aria-label="Search"]')) window.setTimeout(() => setSbOpen(false), 0);
    };
    // capture: look at the tap before the menu re-draws itself
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [sbOpen]);
  // swipe the open menu to the left to close it (it follows your finger)
  useEffect(() => {
    if (!sbOpen) return;
    const el = () => document.querySelector<HTMLElement>('.sidebar');
    let x0 = 0, y0 = 0, dx = 0, mode: 'undecided' | 'drag' | 'scroll' = 'undecided', t0 = 0;
    const start = (e: TouchEvent) => { if (e.touches.length !== 1) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; mode = 'undecided'; t0 = Date.now(); };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (mode === 'undecided' && Math.hypot(mx, my) > 10) mode = Math.abs(mx) > Math.abs(my) && mx < 0 ? 'drag' : 'scroll';
      if (mode !== 'drag') return;
      e.preventDefault();
      dx = Math.min(0, mx);
      const sb = el(); if (sb) { sb.style.transition = 'none'; sb.style.transform = `translateX(${dx}px)`; }
      const bd = document.querySelector<HTMLElement>('.sb-backdrop'); if (bd && sb) bd.style.opacity = String(Math.max(0, 1 + dx / sb.offsetWidth));
    };
    const end = () => {
      if (mode !== 'drag') return;
      const sb = el(); const w = sb?.offsetWidth ?? 300;
      const fast = dx / Math.max(1, Date.now() - t0) < -0.25; // a quick flick closes too
      if (sb) { sb.style.transition = ''; sb.style.transform = ''; }
      const bd = document.querySelector<HTMLElement>('.sb-backdrop'); if (bd) bd.style.opacity = '';
      if (dx < -w / 4 || (fast && dx < -30)) setSbOpen(false);
      mode = 'undecided';
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
    return () => { document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', end); const sb = el(); if (sb) { sb.style.transition = ''; sb.style.transform = ''; } };
  }, [sbOpen]);
  useEffect(() => { if (!sbOpen) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSbOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [sbOpen]);

  // Validate a remembered route (project may have been deleted)
  const ok = useLiveQuery(async () => {
    if (route.view === 'write') return !!(await db.scenes.get(route.sceneId));
    if ('projectId' in route && !(await db.projects.get(route.projectId))) return false;
    return true;
  }, [route]);
  useEffect(() => { if (ok === false) go({ view: 'home' }); }, [ok]);

  // global shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const n = getNav();
      void mod;
      if (matches(e, 'palette')) { e.preventDefault(); setNav({ paletteOpen: !n.paletteOpen }); }
      if (matches(e, 'settings')) { e.preventDefault(); setNav({ settingsOpen: true }); }
      if (matches(e, 'sidebar')) { e.preventDefault(); import('./settings').then(({ setSettings, getSettings }) => setSettings({ sidebarCollapsed: !getSettings().sidebarCollapsed })); }
      if (matches(e, 'fullscreen')) { e.preventDefault(); import('./components/EditorPane').then((m) => m.toggleFullscreen()); }
      if (e.key === 'Escape' && n.reading) setNav({ reading: false });
      if (matches(e, 'editingMode')) { e.preventDefault(); setNav({ editing: !n.editing }); }
      if (matches(e, 'trackChanges')) { e.preventDefault(); setNav({ tracking: !n.tracking }); }
      if (matches(e, 'quickNote')) { e.preventDefault(); setNav({ quickNote: true }); }
      if (matches(e, 'projectSearch') && 'projectId' in n.route) { e.preventDefault(); go({ view: 'search', projectId: n.route.projectId }); }
      if (matches(e, 'closeTab') && n.route.view === 'write') { e.preventDefault(); closeTab(n.route.sceneId); }
      if (matches(e, 'nextTab') && n.route.view === 'write') {
        e.preventDefault();
        const r = n.route;
        db.scenes.bulkGet(n.tabs).then((sc) => {
          const mine = n.tabs.filter((_, i) => sc[i]?.projectId === r.projectId);
          if (mine.length < 2) return;
          const i = mine.indexOf(r.sceneId);
          const next = mine[(i + (e.shiftKey ? -1 : 1) + mine.length) % mine.length];
          go({ view: 'write', projectId: r.projectId, sceneId: next, splitSceneId: r.splitSceneId !== next ? r.splitSceneId : undefined });
        });
      }
    };
    const fs = () => { if (!document.fullscreenElement && getNav().fullscreen) setNav({ fullscreen: false }); };
    window.addEventListener('keydown', k);
    document.addEventListener('fullscreenchange', fs);
    return () => { window.removeEventListener('keydown', k); document.removeEventListener('fullscreenchange', fs); };
  }, []);

  const hideChrome = (nav.fullscreen || nav.reading) && route.view === 'write';

  return (
    <div className={'app' + (hideChrome ? ' chrome-hidden' : '') + (sbOpen ? ' sb-open' : '')}>
      {!hideChrome && <Sidebar />}
      {sbOpen && <div className="sb-backdrop" onClick={() => setSbOpen(false)} aria-hidden="true" />}
      <a href="#main-content" className="skip-link" onClick={(e) => { e.preventDefault(); (document.querySelector('.prose, #main-content') as HTMLElement | null)?.focus(); }}>Skip to content</a>
      <main className="main" id="main-content" tabIndex={-1}>
        <UpdateBanner />
        {readOnly && <div className="readonly-bar"><Eye size={14} /> You're a <strong>{viewRole === 'viewer' ? 'Viewer' : 'Commenter'}</strong> in this shared project: you can read everything, but changes you make won't be saved.</div>}
        {!hideChrome && (
          <div className="phone-bar">
            <button className="icon-btn" aria-label="Menu" aria-expanded={sbOpen} onClick={() => setSbOpen(true)}><Menu size={20} /></button>
            <span className="phone-title ellipsis">{PHONE_TITLES[route.view] ?? 'Writell'}</span>
            <button className="icon-btn" aria-label="Search" onClick={() => setNav({ paletteOpen: true })}><Search size={18} /></button>
          </div>
        )}
        <ErrorBoundary resetKey={JSON.stringify(route)}>
        {route.view === 'home' && <HomeView />}
        {route.view === 'projects' && <ProjectsView filter={route.filter} />}
        {route.view === 'project' && <ProjectOverview projectId={route.projectId} />}
        {route.view === 'characters' && <CharactersView projectId={route.projectId} entityId={route.entityId} />}
        {route.view === 'world' && <WorldView projectId={route.projectId} entityId={route.entityId} category={route.category} />}
        {route.view === 'notes' && <NotesView projectId={route.projectId} entityId={route.entityId} filter={route.filter} />}
        {route.view === 'search' && <SearchView projectId={route.projectId} q={route.q} />}
        {route.view === 'statistics' && <StatsView scope={route.scope} />}
        {route.view === 'trash' && <TrashView />}
        {route.view === 'friends' && <FriendsView />}
        {route.view === 'tasks' && <TasksView projectId={route.projectId} />}
        {route.view === 'family' && <FamilyTreesView projectId={route.projectId} entityId={route.entityId} />}
        {route.view === 'maps' && <MapsView projectId={route.projectId} entityId={route.entityId} />}
        {route.view === 'relationships' && <RelationshipMapView projectId={route.projectId} />}
        {route.view === 'timelines' && <TimelinesView projectId={route.projectId} tab={route.tab} timelineId={route.timelineId} characterId={route.characterId} eventId={route.eventId} />}
        {route.view === 'write' && (
          <div className="writing">
          {!hideChrome && <TabBar projectId={route.projectId} />}
          <div className={'panes' + (route.splitSceneId ? ' split' : '')}>
            <EditorPane key={route.sceneId} sceneId={route.sceneId} />
            {route.splitSceneId && route.splitSceneId !== route.sceneId && !nav.reading && (
              <EditorPane key={'b' + route.splitSceneId} sceneId={route.splitSceneId} secondary onClose={() => go({ view: 'write', projectId: route.projectId, sceneId: route.sceneId })} />
            )}
          </div>
          </div>
        )}
        </ErrorBoundary>
        {nav.reading && <button className="exit-reading" onClick={() => setNav({ reading: false })}>Exit reading mode (Esc)</button>}
      </main>
      {nav.settingsOpen && <SettingsModal />}
      {nav.paletteOpen && <CommandPalette />}
      {nav.helpOpen && <Help />}
      {nav.newProject && <NewProjectDialog />}
      {nav.exportFor && <ExportDialog projectId={nav.exportFor} onClose={() => setNav({ exportFor: null })} />}
      {nav.shareFor && <ShareDialog projectId={nav.shareFor} onClose={() => setNav({ shareFor: null })} />}
      {nav.joinLink !== null && <JoinDialog initial={nav.joinLink} onClose={() => setNav({ joinLink: null })} />}
      {nav.quickNote && <QuickNote projectId={'projectId' in route ? route.projectId : null} onClose={() => setNav({ quickNote: false })} />}
      <DialogHost />
      <MenuHost />
      <ToastHost />
    </div>
  );
}

const helpShortcuts = (): [string, string][] => [
  [combo('palette'), 'Search & command palette'], [combo('quickNote'), 'Quick idea → notes inbox'], [combo('projectSearch'), 'Search the whole project'],
  [combo('editingMode'), 'Writing / editing mode'], [combo('trackChanges'), 'Track changes on / off'], [combo('comment'), 'Comment on the selection'],
  [combo('find') + ' / ' + combo('replace'), 'Find / find & replace'], [combo('save'), 'Save now (autosave is always on)'], [combo('rawMarkdown'), 'Raw Markdown'],
  [combo('nextTab') + ' / ' + combo('closeTab'), 'Next tab / close tab'], [combo('sidebar'), 'Compact / expand sidebar'], [combo('settings'), 'Settings'], [combo('fullscreen'), 'Full screen'],
  ['Ctrl + B / I / U', 'Bold / italic / underline'], ['Ctrl + Shift + S / H', 'Strikethrough / highlight'], ['Ctrl + Z / Ctrl + Y', 'Undo / redo'],
];
const MD: [string, string][] = [
  ['**bold**', 'bold'], ['*italic*', 'italic'], ['~~strike~~', 'strikethrough'], ['==highlight==', 'highlight'],
  ['# , ## , ### ', 'headings'], ['- or * ', 'bulleted list'], ['1. ', 'numbered list'], ['> ', 'blockquote'], ['[text](url)', 'link (in raw mode)'],
];

function Help() {
  return (
    <Modal title="Help & shortcuts" onClose={() => setNav({ helpOpen: false })}>
      <div className="help">
        <h3>Keyboard shortcuts</h3>
        <p className="muted small">Change these in Settings → Keyboard.</p>
        <table><tbody>{helpShortcuts().map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
        <h3>Markdown while you type</h3>
        <table><tbody>{MD.map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{v}</td></tr>)}</tbody></table>
        <h3>Organizing</h3>
        <p className="muted">Right-click chapters and scenes in the sidebar to rename, duplicate, color, delete or open in split view. Drag chapters to reorder them; drag scenes to reorder or move them to another chapter.</p>
        <p className="muted">With the cursor inside a word and nothing selected, bold / italic / underline / strikethrough / highlight change the whole word. At the edge of a word they set the style for what you type next — and the app remembers that choice if you click away and come back.</p>
        <p className="muted">Open a scene's details (panel icon, top right of the editor) to tag which characters appear in it and where it's set. Character and place pages then list those scenes automatically.</p>
      </div>
    </Modal>
  );
}
