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
  { name: 'Ocean', mode: 'dark', bg: '#121a22', panel: '#16202a', border: '#24323f', text: '#dfe8ef', muted: '#81939f', accent: '#4fb3d9' },
  { name: 'Dusk', mode: 'dark', bg: '#17152a', panel: '#1d1a33', border: '#2e2a4a', text: '#e5e2f3', muted: '#8d88a8', accent: '#a78bfa' },
  { name: 'Rose', mode: 'dark', bg: '#1b1418', panel: '#22191e', border: '#38282f', text: '#f0e2e8', muted: '#a08791', accent: '#ec6f9b' },
  { name: 'Mocha', mode: 'dark', bg: '#1c1714', panel: '#241d19', border: '#3a2f28', text: '#eee3d8', muted: '#a3917f', accent: '#d4a373' },
  { name: 'Arctic', mode: 'dark', bg: '#1d222b', panel: '#232934', border: '#343c4a', text: '#e5e9f0', muted: '#8c96a8', accent: '#88c0d0' },
  { name: 'Moss', mode: 'dark', bg: '#161a12', panel: '#1c2117', border: '#2d3526', text: '#e4e9dc', muted: '#8f9a83', accent: '#a3c45a' },
  { name: 'Ink', mode: 'dark', bg: '#0b0b0d', panel: '#121215', border: '#24242a', text: '#f2f2f4', muted: '#8a8a94', accent: '#f5c451' },
  { name: 'Paper', mode: 'light', bg: '#f6f5f2', panel: '#eeece7', border: '#dcd9d1', text: '#22211f', muted: '#76736c', accent: '#6b5ce7' },
  { name: 'Snow', mode: 'light', bg: '#fbfbfc', panel: '#f1f2f5', border: '#dfe1e7', text: '#1c1e24', muted: '#6f7380', accent: '#3b82f6' },
  { name: 'Sand', mode: 'light', bg: '#f5efe4', panel: '#ece4d5', border: '#d8ccb6', text: '#2b241b', muted: '#7d705e', accent: '#c2703d' },
  { name: 'Sakura', mode: 'light', bg: '#fbf3f5', panel: '#f3e6ea', border: '#e3cdd5', text: '#2c1f24', muted: '#86707a', accent: '#d9487a' },
  { name: 'Mint', mode: 'light', bg: '#f1f7f3', panel: '#e5efe8', border: '#cfdfd4', text: '#1d2a22', muted: '#6c7f72', accent: '#2f9e6a' },
  { name: 'Lavender', mode: 'light', bg: '#f6f4fb', panel: '#ece8f6', border: '#d9d2ec', text: '#24202f', muted: '#776f8c', accent: '#7c5ce6' },
];

/** quick accent colours that work on any theme */
export const ACCENTS = ['#8b7cf6', '#6b5ce7', '#3b82f6', '#4fb3d9', '#2fb5a3', '#5fbf8f', '#a3c45a', '#f5c451', '#e8925a', '#e5604f', '#ec6f9b', '#c084fc'];

export const EDITOR_THEMES: EditorTheme[] = [
  { name: 'Match app', bg: '', text: '', highlight: '' },
  { name: 'Warm dark', bg: '#1f1b17', text: '#e9dfd2', highlight: '#5a4a2a' },
  { name: 'Deep blue', bg: '#151a24', text: '#d9e1ee', highlight: '#2c4466' },
  { name: 'Sepia', bg: '#f1e7d3', text: '#3b3024', highlight: '#e8cf8a' },
  { name: 'Paper white', bg: '#fbfaf7', text: '#1f1f1f', highlight: '#fde68a' },
  { name: 'Charcoal', bg: '#1b1c1f', text: '#dcdde1', highlight: '#4a4630' },
  { name: 'Night ink', bg: '#0f1117', text: '#cdd3e0', highlight: '#33406a' },
  { name: 'Forest floor', bg: '#161d18', text: '#d8e4da', highlight: '#2f4a33' },
  { name: 'Plum', bg: '#1d1621', text: '#e7dcec', highlight: '#4b2f55' },
  { name: 'Cream', bg: '#fbf6ea', text: '#2f2a22', highlight: '#f3d98b' },
  { name: 'Mint paper', bg: '#f0f7f2', text: '#1f2b24', highlight: '#bfe5c9' },
  { name: 'Rose paper', bg: '#fbf1f3', text: '#33232a', highlight: '#f6c4d2' },
  { name: 'Sky', bg: '#eef4fa', text: '#1d2733', highlight: '#c6dcf3' },
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
  mouseCursor: CursorKind;
  /** size of Writell's own pointer, px */
  cursorSize: number;
  /** little effects that follow the pointer */
  cursorFx: 'none' | 'ripple' | 'trail' | 'sparkle';
  /** the text cursor while writing: the browser's own, or Writell's (shape, glide, blink) */
  caretStyle: 'native' | 'line' | 'bar' | 'block' | 'underline';
  caretSmooth: boolean;
  caretBlink: 'blink' | 'fade' | 'solid';
  caretColor: 'accent' | 'text';
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
  cursorSize: 21,
  cursorFx: 'none',
  caretStyle: 'native',
  caretSmooth: true,
  caretBlink: 'blink',
  caretColor: 'accent',
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
export const subscribeSettings = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

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
  applyCursor(s.mouseCursor ?? 'system', s.cursorSize ?? 21, t.accent);
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
export type CursorKind = 'system' | 'black' | 'white' | 'outline' | 'accent' | 'classic' | 'dot' | 'pencil' | 'glow';
export const CURSORS: { id: CursorKind; label: string }[] = [
  { id: 'system', label: 'System' }, { id: 'black', label: 'Black' }, { id: 'white', label: 'White' }, { id: 'outline', label: 'Outline' },
  { id: 'accent', label: 'Accent' }, { id: 'glow', label: 'Glow' }, { id: 'classic', label: 'Classic' }, { id: 'dot', label: 'Dot' }, { id: 'pencil', label: 'Pencil' },
];
export const cursorPreview = (kind: Exclude<CursorKind, 'system'>, accent = getSettings().theme.accent) => cursorSet(kind, 21, accent).arrow.split(' ')[0];
const svg = (body: string, px: number) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${px}' height='${px}' viewBox='0 0 32 32'>${body}</svg>`)}")`;
// a clean, rounded dart pointing up-left (its tip is the click point)
const DART = 'M5.5 4.5 26 12.7 16.4 16.4 12.7 26Z';
// the classic arrow with a tail
const CLASSIC = 'M6 4v20.5l5.3-5.1 3.6 8.1 3.5-1.6-3.6-7.9h7.3Z';
// a slim text cursor
const BEAM = 'M12 6.5h1.6c1 0 1.8.5 2.4 1.2.6-.7 1.4-1.2 2.4-1.2H20M16 7.8v16.4M12 25.5h1.6c1 0 1.8-.5 2.4-1.2.6.7 1.4 1.2 2.4 1.2H20';
// a pencil, writing tip at the bottom left
const PENCIL_BODY = 'M9.5 22.5 22.8 9.2a2.4 2.4 0 0 1 3.4 0l.6.6a2.4 2.4 0 0 1 0 3.4L13.5 26.5Z';
const PENCIL_TIP = 'M9.5 22.5 13.5 26.5 6.2 29.8Z';
function cursorSet(kind: Exclude<CursorKind, 'system'>, px: number, accent: string) {
  const shadow = `<defs><filter id='s' x='-40%' y='-40%' width='180%' height='180%'><feDropShadow dx='0' dy='1.2' stdDeviation='1.1' flood-opacity='0.35'/></filter><filter id='g' x='-60%' y='-60%' width='220%' height='220%'><feGaussianBlur stdDeviation='1.6'/></filter></defs>`;
  const k = px / 32; // hotspots are given in the 32-unit drawing; scale them to the real size
  const hs = (x: number, y: number) => `${Math.round(x * k)} ${Math.round(y * k)}`;
  const solid = (d: string, fill: string, edge: string) => `${shadow}<path filter='url(#s)' d='${d}' fill='${edge}' stroke='${edge}' stroke-width='5.2' stroke-linejoin='round'/><path d='${d}' fill='${fill}' stroke='${fill}' stroke-width='2.2' stroke-linejoin='round'/>`;
  const beamOf = (fill: string, edge: string) => `${shadow}<path filter='url(#s)' d='${BEAM}' fill='none' stroke='${edge}' stroke-width='4' stroke-linecap='round'/><path d='${BEAM}' fill='none' stroke='${fill}' stroke-width='1.8' stroke-linecap='round'/>`;
  let dart: string, beam: string, hot = hs(5, 4);
  if (kind === 'outline') {
    // like an iPad pointer: see-through middle, bright edge
    dart = `${shadow}<path filter='url(#s)' d='${DART}' fill='#000' fill-opacity='.45' stroke='#000' stroke-opacity='.55' stroke-width='5' stroke-linejoin='round'/><path d='${DART}' fill='none' stroke='#fff' stroke-width='2.4' stroke-linejoin='round'/>`;
    beam = `${shadow}<path filter='url(#s)' d='${BEAM}' fill='none' stroke='#000' stroke-opacity='.6' stroke-width='4' stroke-linecap='round'/><path d='${BEAM}' fill='none' stroke='#fff' stroke-width='1.7' stroke-linecap='round'/>`;
  } else if (kind === 'accent') {
    dart = solid(DART, accent, '#ffffff'); beam = beamOf(accent, '#ffffff');
  } else if (kind === 'glow') {
    dart = `${shadow}<path filter='url(#g)' d='${DART}' fill='${accent}' stroke='${accent}' stroke-width='5' stroke-linejoin='round' opacity='.85'/><path d='${DART}' fill='#fff' stroke='#fff' stroke-width='1.6' stroke-linejoin='round'/>`;
    beam = `${shadow}<path filter='url(#g)' d='${BEAM}' fill='none' stroke='${accent}' stroke-width='4.5' stroke-linecap='round'/><path d='${BEAM}' fill='none' stroke='#fff' stroke-width='1.6' stroke-linecap='round'/>`;
  } else if (kind === 'classic') {
    dart = solid(CLASSIC, '#ffffff', '#0d0d0f'); beam = beamOf('#0d0d0f', '#ffffff'); hot = hs(6, 4);
  } else if (kind === 'dot') {
    // a soft round dot; its middle is the click point
    dart = `${shadow}<circle filter='url(#s)' cx='16' cy='16' r='7.5' fill='#0d0d0f' fill-opacity='.55' stroke='#fff' stroke-width='2.2'/>`;
    beam = beamOf('#ffffff', '#0d0d0f'); hot = hs(16, 16);
  } else if (kind === 'pencil') {
    dart = `${shadow}<path filter='url(#s)' d='${PENCIL_BODY}' fill='${accent}' stroke='#0d0d0f' stroke-width='1.6' stroke-linejoin='round'/><path d='${PENCIL_TIP}' fill='#f3d9a6' stroke='#0d0d0f' stroke-width='1.6' stroke-linejoin='round'/><path d='M7.2 28.3 6.2 29.8 7.8 29.1Z' fill='#0d0d0f'/><path d='M21.4 10.6l4 4' stroke='#0d0d0f' stroke-width='1.4'/>`;
    beam = beamOf('#0d0d0f', '#ffffff'); hot = hs(6, 30);
  } else {
    const fill = kind === 'black' ? '#0d0d0f' : '#ffffff', edge = kind === 'black' ? '#ffffff' : '#0d0d0f';
    dart = solid(DART, fill, edge); beam = beamOf(fill, edge);
  }
  const arrow = svg(dart, px);
  return { arrow: `${arrow} ${hot}, default`, beam: `${svg(beam, px)} ${hs(16, 16)}, text`, hand: `${arrow} ${hot}, pointer` };
}
function applyCursor(kind: CursorKind, px: number, accent: string) {
  const r = document.documentElement;
  if (kind === 'system') { r.removeAttribute('data-cursor'); ['--cur-default', '--cur-text', '--cur-pointer'].forEach((v) => r.style.removeProperty(v)); return; }
  const c = cursorSet(kind, Math.max(14, Math.min(48, Math.round(px))), accent);
  r.setAttribute('data-cursor', kind);
  r.style.setProperty('--cur-default', c.arrow);
  r.style.setProperty('--cur-text', c.beam);
  r.style.setProperty('--cur-pointer', c.hand);
}
