import { useSyncExternalStore } from 'react';

/*
 * App-wide preferences. Small, per-device, so they live in localStorage
 * (wrapped in try/catch). Writing data never lives here — that is IndexedDB.
 */

export interface Theme {
  name: string;
  mode: 'dark' | 'light';
  bg: string;       // app background
  panel: string;    // sidebar / panels
  border: string;
  text: string;
  muted: string;
  accent: string;
}

export interface EditorTheme {
  name: string;
  bg: string;
  text: string;
  highlight: string;
}

export const THEMES: Theme[] = [
  { name: 'Midnight', mode: 'dark', bg: '#16171b', panel: '#1c1d22', border: '#2b2d34', text: '#e6e6ea', muted: '#8b8d98', accent: '#8b7cf6' },
  { name: 'Graphite', mode: 'dark', bg: '#181818', panel: '#1f1f1f', border: '#2e2e2e', text: '#e8e8e8', muted: '#8f8f8f', accent: '#5fa8f5' },
  { name: 'Forest', mode: 'dark', bg: '#141a17', panel: '#19201c', border: '#27322c', text: '#e1e9e3', muted: '#86958b', accent: '#5fbf8f' },
  { name: 'Ember', mode: 'dark', bg: '#1a1614', panel: '#211b18', border: '#342a25', text: '#ece3dd', muted: '#9a8b82', accent: '#e8925a' },
  { name: 'Paper', mode: 'light', bg: '#f6f5f2', panel: '#eeece7', border: '#dcd9d1', text: '#22211f', muted: '#76736c', accent: '#6b5ce7' },
];

export const EDITOR_THEMES: EditorTheme[] = [
  { name: 'Match app', bg: '', text: '', highlight: '' },
  { name: 'Warm dark', bg: '#1f1b17', text: '#e9dfd2', highlight: '#5a4a2a' },
  { name: 'Deep blue', bg: '#151a24', text: '#d9e1ee', highlight: '#2c4466' },
  { name: 'Sepia', bg: '#f1e7d3', text: '#3b3024', highlight: '#e8cf8a' },
  { name: 'Paper white', bg: '#fbfaf7', text: '#1f1f1f', highlight: '#fde68a' },
];

export interface Settings {
  theme: Theme;
  customThemes: Theme[];
  editorTheme: EditorTheme;
  customEditorThemes: EditorTheme[];
  uiScale: number;            // 0.85 – 1.25
  sidebarWidth: number;       // px
  sidebarCollapsed: boolean;  // icon-only mode
  editorFont: string;
  uiFont: string;
  editorFontSize: number;     // px
  lineHeight: number;
  editorWidth: number;        // px max width of text column
  paragraphSpacing: number;   // em
  typewriter: boolean;
  focusMode: boolean;
  spellcheck: boolean;
  /** hover a character's name in your text to see their card */
  charCards: boolean;
  /** sidebar extras, off by default to keep it calm */
  sbRecentScenes: boolean;
  sbRecentChars: boolean;
  /** extra space left and right inside the writing column, px */
  editorMargin: number;
  /** mouse pointer inside Writell: the system one, or Writell's own smooth black / white */
  mouseCursor: 'system' | 'black' | 'white' | 'outline';
  showStatsBar: boolean;
  autosaveDelay: number;      // ms
  autoBackupMinutes: number;  // 0 = off
  toolbar: string[];          // visible toolbar buttons
  showStats: boolean;         // statistics & goals (optional)
  dailyGoal: number;
  weeklyGoal: number;
  monthlyGoal: number;
  sidebarTools: { id: string; visible: boolean }[]; // order + visibility of project tools
  sidebarV7?: boolean;
  aiEnabled: boolean;
  aiKey: string;
  aiModel: string;
  shortcuts: Record<string, string>;
  startMode: 'writing' | 'editing' | 'focus' | 'typewriter';
  defaultTemplate: string;
  pins: { projectId: string; kind: 'scene' | 'entity' | 'chapter'; id: string }[];
}

export const ALL_TOOLS = ['bold', 'italic', 'underline', 'strike', 'highlight', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'quote', 'link', 'undo', 'redo'] as const;

export const FONTS = [
  { label: 'Literata (serif)', value: "'Literata', Georgia, serif" },
  { label: 'Source Serif', value: "'Source Serif 4', Georgia, serif" },
  { label: 'Inter (sans)', value: "'Inter', system-ui, sans-serif" },
  { label: 'iA Writer-like mono', value: "'IBM Plex Mono', ui-monospace, monospace" },
  { label: 'System serif', value: 'Georgia, Cambria, serif' },
  { label: 'System sans', value: 'system-ui, -apple-system, Segoe UI, sans-serif' },
];

const DEFAULTS: Settings = {
  theme: THEMES[0],
  customThemes: [],
  editorTheme: EDITOR_THEMES[1],
  customEditorThemes: [],
  uiScale: 1,
  sidebarWidth: 260,
  sidebarCollapsed: false,
  editorFont: FONTS[0].value,
  uiFont: "'Inter', system-ui, sans-serif",
  editorFontSize: 18,
  lineHeight: 1.75,
  editorWidth: 720,
  paragraphSpacing: 0.9,
  typewriter: false,
  focusMode: false,
  spellcheck: true,
  charCards: true,
  sbRecentScenes: false,
  sbRecentChars: false,
  editorMargin: 0,
  mouseCursor: 'system',
  showStatsBar: true,
  autosaveDelay: 600,
  autoBackupMinutes: 10,
  toolbar: [...ALL_TOOLS],
  showStats: true,
  dailyGoal: 500,
  weeklyGoal: 3000,
  monthlyGoal: 12000,
  sidebarTools: [],
  aiEnabled: false,
  aiKey: '',
  aiModel: 'claude-sonnet-5-5',
  shortcuts: {},
  startMode: 'writing',
  defaultTemplate: 'blank',
  pins: [],
};

const KEY = 'inkwell.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // v0.7.0: simpler sidebar — project Statistics and Search move out of the tool list once
      if (!saved.sidebarV7) {
        saved.sidebarV7 = true;
        if (Array.isArray(saved.sidebarTools)) saved.sidebarTools = saved.sidebarTools.map((t: { id: string; visible: boolean }) => (t.id === 'statistics' || t.id === 'search' ? { ...t, visible: false } : t));
      }
      return { ...DEFAULTS, ...saved };
    }
  } catch { /* storage unavailable */ }
  return DEFAULTS;
}

let state = load();
const listeners = new Set<() => void>();

export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function resetSettings() { setSettings(DEFAULTS); }

export function useSettings(): Settings {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

export const getSettings = () => state;

/** Push settings into CSS custom properties */
export function applySettingsToDOM(s: Settings) {
  const r = document.documentElement.style;
  const t = s.theme;
  r.setProperty('--bg', t.bg);
  r.setProperty('--panel', t.panel);
  r.setProperty('--border', t.border);
  r.setProperty('--text', t.text);
  r.setProperty('--muted', t.muted);
  r.setProperty('--accent', t.accent);
  r.setProperty('--ed-bg', s.editorTheme.bg || t.bg);
  r.setProperty('--ed-text', s.editorTheme.text || t.text);
  r.setProperty('--ed-hl', s.editorTheme.highlight || (t.mode === 'dark' ? '#5a4a2a' : '#fde68a'));
  r.setProperty('--ed-font', s.editorFont);
  r.setProperty('--ui-font', s.uiFont);
  r.setProperty('--ed-size', s.editorFontSize + 'px');
  r.setProperty('--ed-lh', String(s.lineHeight));
  r.setProperty('--ed-width', s.editorWidth + 'px');
  r.setProperty('--ed-margin', (s.editorMargin ?? 0) + 'px');
  applyCursor(s.mouseCursor ?? 'system');
  r.setProperty('--ed-para', s.paragraphSpacing + 'em');
  r.setProperty('--sidebar-w', s.sidebarWidth + 'px');
  r.setProperty('zoom', String(s.uiScale));
  r.setProperty('--ui-scale', String(s.uiScale));
  document.documentElement.dataset.mode = t.mode;
  document.documentElement.style.colorScheme = t.mode;
}

export type PinRef = Settings['pins'][number];
export const isPinned = (p: Omit<PinRef, 'projectId'>) => getSettings().pins.some((x) => x.kind === p.kind && x.id === p.id);
export function togglePin(p: PinRef) {
  const pins = getSettings().pins;
  setSettings({ pins: pins.some((x) => x.kind === p.kind && x.id === p.id) ? pins.filter((x) => !(x.kind === p.kind && x.id === p.id)) : [...pins, p] });
}

/* ---- custom mouse cursor (only inside Writell) ---- */
export const cursorPreview = (kind: 'black' | 'white' | 'outline') => cursorSet(kind).arrow.split(' ')[0];
const svg = (body: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='21' height='21' viewBox='0 0 32 32'>${body}</svg>`)}")`;
// a clean, rounded dart pointing up-left (its tip is the click point)
const DART = 'M5.5 4.5 26 12.7 16.4 16.4 12.7 26Z';
// a slim text cursor
const BEAM = 'M12 6.5h1.6c1 0 1.8.5 2.4 1.2.6-.7 1.4-1.2 2.4-1.2H20M16 7.8v16.4M12 25.5h1.6c1 0 1.8-.5 2.4-1.2.6.7 1.4 1.2 2.4 1.2H20';
function cursorSet(kind: 'black' | 'white' | 'outline') {
  const shadow = `<defs><filter id='s' x='-40%' y='-40%' width='180%' height='180%'><feDropShadow dx='0' dy='1.2' stdDeviation='1.1' flood-opacity='0.35'/></filter></defs>`;
  let dart: string, beam: string;
  if (kind === 'outline') {
    // like an iPad pointer: see-through middle, bright edge
    dart = `${shadow}<path filter='url(#s)' d='${DART}' fill='#000' fill-opacity='.45' stroke='#000' stroke-opacity='.55' stroke-width='5' stroke-linejoin='round'/><path d='${DART}' fill='none' stroke='#fff' stroke-width='2.4' stroke-linejoin='round'/>`;
    beam = `${shadow}<path filter='url(#s)' d='${BEAM}' fill='none' stroke='#000' stroke-opacity='.6' stroke-width='4' stroke-linecap='round'/><path d='${BEAM}' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round'/>`;
  } else {
    const fill = kind === 'black' ? '#0d0d0f' : '#ffffff', edge = kind === 'black' ? '#ffffff' : '#0d0d0f';
    dart = `${shadow}<path filter='url(#s)' d='${DART}' fill='${edge}' stroke='${edge}' stroke-width='5.2' stroke-linejoin='round'/><path d='${DART}' fill='${fill}' stroke='${fill}' stroke-width='2.2' stroke-linejoin='round'/>`;
    beam = `${shadow}<path filter='url(#s)' d='${BEAM}' fill='none' stroke='${edge}' stroke-width='4' stroke-linecap='round'/><path d='${BEAM}' fill='none' stroke='${fill}' stroke-width='1.8' stroke-linecap='round'/>`;
  }
  const arrow = svg(dart);
  return { arrow: `${arrow} 4 3, default`, beam: `${svg(beam)} 10 10, text`, hand: `${arrow} 4 3, pointer` };
}
function applyCursor(kind: 'system' | 'black' | 'white' | 'outline') {
  const r = document.documentElement;
  if (kind === 'system') { r.removeAttribute('data-cursor'); ['--cur-default', '--cur-text', '--cur-pointer'].forEach((v) => r.style.removeProperty(v)); return; }
  const c = cursorSet(kind);
  r.setAttribute('data-cursor', kind);
  r.style.setProperty('--cur-default', c.arrow);
  r.style.setProperty('--cur-text', c.beam);
  r.style.setProperty('--cur-pointer', c.hand);
}
