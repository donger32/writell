import { useSyncExternalStore } from 'react';
import { db, now } from './db';
import { getSettings } from './settings';

/* Tiny global navigation store (no router needed for a desktop-style app) */

export type Route =
  | { view: 'home' }
  | { view: 'projects'; filter?: 'all' | 'favorites' | 'archived' }
  | { view: 'project'; projectId: string }
  | { view: 'write'; projectId: string; sceneId: string; splitSceneId?: string }
  | { view: 'characters'; projectId: string; entityId?: string }
  | { view: 'world'; projectId: string; entityId?: string; category?: string }
  | { view: 'notes'; projectId: string; entityId?: string; filter?: string }
  | { view: 'search'; projectId: string; q?: string }
  | { view: 'family'; projectId: string; entityId?: string }
  | { view: 'relationships'; projectId: string }
  | { view: 'maps'; projectId: string; entityId?: string }
  | { view: 'timelines'; projectId: string; tab?: 'world' | 'story' | 'character'; timelineId?: string; characterId?: string; eventId?: string }
  | { view: 'statistics'; scope?: string }
  // `from`: the project you came from, which stays open in the sidebar
  | { view: 'trash'; from?: string }
  | { view: 'friends'; from?: string }
  | { view: 'admin'; from?: string }
  | { view: 'chat'; projectId: string; focusId?: string }
  | { view: 'tasks'; projectId: string }
  | { view: 'revision'; projectId: string };

export interface NavState {
  route: Route;
  settingsOpen: boolean;
  settingsTab: string;
  paletteOpen: boolean;
  helpOpen: boolean;
  fullscreen: boolean;
  reading: boolean;
  tabs: string[]; // open scene ids (all projects)
  quickNote: boolean;
  editing: boolean; // editing (revision) mode vs writing mode
  newProject: boolean;
  tracking: boolean; // track changes on
  exportFor: string | null; // project id when the export dialog is open
  shareFor: string | null;  // project id when the share dialog is open
  joinLink: string | null;  // invite link being joined ('' = paste one)
}

const KEY = 'inkwell.nav.v1';
function loadRoute(): Route {
  try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch { /* */ }
  return { view: 'home' };
}

const TKEY = 'inkwell.tabs.v1';
function loadTabs(): string[] {
  try { return JSON.parse(localStorage.getItem(TKEY) || '[]'); } catch { return []; }
}

let state: NavState = { route: loadRoute(), settingsOpen: false, settingsTab: 'appearance', paletteOpen: false, helpOpen: false, fullscreen: false, reading: false, tabs: loadTabs(), quickNote: false, editing: getSettings().startMode === 'editing', newProject: false, exportFor: null, shareFor: null, joinLink: null, tracking: false };
const ls = new Set<() => void>();

export function setNav(p: Partial<NavState>) {
  const prevRoute = state.route;
  state = { ...state, ...p };
  if (p.route) {
    try { localStorage.setItem(KEY, JSON.stringify(p.route)); } catch { /* */ }
    const r = p.route;
    if ('projectId' in r) db.projects.update(r.projectId, { openedAt: now() });
    if ((r.view === 'characters' || r.view === 'world') && r.entityId) pushRecentEntity(r.entityId);
    if (r.view === 'write') {
      pushRecentScene(r.sceneId);
      if (!state.tabs.includes(r.sceneId)) {
        // open next to the current tab
        const prev = p.route && 'sceneId' in prevRoute ? state.tabs.indexOf(prevRoute.sceneId) : -1;
        const tabs = [...state.tabs];
        tabs.splice(prev >= 0 ? prev + 1 : tabs.length, 0, r.sceneId);
        state = { ...state, tabs: tabs.slice(-30) };
      }
    }
  }
  if (p.route || p.tabs) { try { localStorage.setItem(TKEY, JSON.stringify(state.tabs)); } catch { /* */ } }
  ls.forEach((l) => l());
}
export const go = (route: Route) => setNav({ route, reading: false });
export const useNav = () => useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => state);
export const getNav = () => state;

/* recently opened scenes (per device) */
const RKEY = 'inkwell.recentScenes';
export function getRecentScenes(): string[] {
  try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch { return []; }
}
function pushRecentScene(id: string) {
  const list = [id, ...getRecentScenes().filter((x) => x !== id)].slice(0, 12);
  try { localStorage.setItem(RKEY, JSON.stringify(list)); } catch { /* */ }
}

export async function openProject(projectId: string) {
  // reopen the scene you were last writing in this project
  const recent = await db.scenes.bulkGet(getRecentScenes());
  const last = recent.find((s) => s?.projectId === projectId);
  if (last) return go({ view: 'write', projectId, sceneId: last.id });
  const first = await db.chapters.where('projectId').equals(projectId).sortBy('order');
  for (const ch of first) {
    const sc = await db.scenes.where('chapterId').equals(ch.id).sortBy('order');
    if (sc.length) return go({ view: 'write', projectId, sceneId: sc[0].id });
  }
  go({ view: 'project', projectId });
}

/** Close a scene tab; if it was the active one, move to a neighbouring tab of the same project */
export async function closeTab(sceneId: string) {
  const r = state.route;
  const idx = state.tabs.indexOf(sceneId);
  const tabs = state.tabs.filter((t) => t !== sceneId);
  if (r.view === 'write' && (r.sceneId === sceneId || r.splitSceneId === sceneId)) {
    if (r.splitSceneId === sceneId) return setNav({ tabs, route: { ...r, splitSceneId: undefined } });
    const scenes = await db.scenes.bulkGet(tabs);
    const same = tabs.filter((_, i) => scenes[i]?.projectId === r.projectId);
    const next = same.find((t) => tabs.indexOf(t) >= idx) ?? same[same.length - 1];
    setNav({ tabs, route: next ? { view: 'write', projectId: r.projectId, sceneId: next } : { view: 'project', projectId: r.projectId } });
  } else setNav({ tabs });
}

const EKEY = 'inkwell.recentEntities';
export function getRecentEntities(): string[] {
  try { return JSON.parse(localStorage.getItem(EKEY) || '[]'); } catch { return []; }
}
function pushRecentEntity(id: string) {
  const list = [id, ...getRecentEntities().filter((x) => x !== id)].slice(0, 20);
  try { localStorage.setItem(EKEY, JSON.stringify(list)); } catch { /* */ }
}
