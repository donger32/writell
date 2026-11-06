import { getSettings } from './settings';

/* Customisable app shortcuts (Settings → Keyboard). Text formatting keys live in the editor. */

export const SHORTCUTS = [
  { id: 'palette', label: 'Search & command palette', def: 'Ctrl+K' },
  { id: 'quickNote', label: 'Quick idea to notes inbox', def: 'Ctrl+Shift+N' },
  { id: 'projectSearch', label: 'Search the whole project', def: 'Ctrl+Shift+F' },
  { id: 'editingMode', label: 'Switch writing / editing mode', def: 'Ctrl+E' },
  { id: 'trackChanges', label: 'Track changes on / off', def: 'Ctrl+Shift+E' },
  { id: 'comment', label: 'Comment on selection', def: 'Ctrl+Alt+M' },
  { id: 'find', label: 'Find in scene', def: 'Ctrl+F' },
  { id: 'replace', label: 'Find & replace', def: 'Ctrl+H' },
  { id: 'save', label: 'Save now', def: 'Ctrl+S' },
  { id: 'rawMarkdown', label: 'Raw Markdown', def: 'Ctrl+Shift+M' },
  { id: 'closeTab', label: 'Close tab', def: 'Ctrl+W' },
  { id: 'nextTab', label: 'Next tab (add Shift for previous)', def: 'Ctrl+Tab' },
  { id: 'sidebar', label: 'Compact / expand sidebar', def: 'Ctrl+\\' },
  { id: 'settings', label: 'Settings', def: 'Ctrl+,' },
  { id: 'fullscreen', label: 'Full screen', def: 'F11' },
] as const;
export type ShortcutId = typeof SHORTCUTS[number]['id'];

export const combo = (id: ShortcutId) => (getSettings().shortcuts?.[id] as string | undefined) ?? SHORTCUTS.find((s) => s.id === id)!.def;

function keyName(e: KeyboardEvent) {
  if (e.key === ' ') return 'Space';
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key; // Tab, F11, Enter, ArrowUp…
}

/** Turn a key press into text like "Ctrl+Shift+N" */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  // with Shift held, punctuation changes (e.g. "," → "<"); use the physical key for letters/digits only
  let k = keyName(e);
  if (e.shiftKey && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  if (e.shiftKey && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
  parts.push(k);
  return parts.join('+');
}

/** Does this key press match the shortcut? ("Shift" is ignored for nextTab, which uses it for direction) */
export function matches(e: KeyboardEvent, id: ShortcutId): boolean {
  const c = comboFromEvent(e);
  if (!c) return false;
  const want = combo(id);
  if (id === 'nextTab') return c.replace('Shift+', '') === want.replace('Shift+', '');
  return c === want;
}
