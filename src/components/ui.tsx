import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronDown, Dices, Minus, Plus } from 'lucide-react';
import { NAME_STYLES, getNameStyle, makeName, setNameStyle } from '../names';

/* ---------- Promise-based dialogs (native confirm/prompt are unreliable in desktop webviews) ---------- */

type Dialog =
  | { kind: 'confirm'; title: string; body?: string; danger?: boolean; ok: string; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; value: string; ok: string; names?: boolean; resolve: (v: string | null) => void };

let dialog: Dialog | null = null;
const dl = new Set<() => void>();
const setDialog = (d: Dialog | null) => { dialog = d; dl.forEach((l) => l()); };

export const confirmDialog = (title: string, body?: string, opts: { danger?: boolean; ok?: string } = {}) =>
  new Promise<boolean>((resolve) => setDialog({ kind: 'confirm', title, body, danger: opts.danger, ok: opts.ok ?? 'OK', resolve }));

export const promptDialog = (title: string, value = '', ok = 'Save', opts: { names?: boolean } = {}) =>
  new Promise<string | null>((resolve) => setDialog({ kind: 'prompt', title, value, ok, names: opts.names, resolve }));

export function DialogHost() {
  const d = useSyncExternalStore((l) => { dl.add(l); return () => dl.delete(l); }, () => dialog);
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (d?.kind === 'prompt') { setVal(d.value); setTimeout(() => inputRef.current?.select(), 0); }
  }, [d]);
  if (!d) return null;
  const close = (ok: boolean) => {
    if (d.kind === 'confirm') d.resolve(ok);
    else d.resolve(ok ? val.trim() || null : null);
    setDialog(null);
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={d.title} onKeyDown={(e) => { trapFocus(e); if (e.key === 'Escape') close(false); if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') close(true); }}>
        <h3>{d.title}</h3>
        {d.kind === 'confirm' && d.body && <p className="muted">{d.body}</p>}
        {d.kind === 'prompt' && (d.names
          ? <div className="row gap-s"><input ref={inputRef} className="input grow" value={val} onChange={(e) => setVal(e.target.value)} autoFocus /><NameDice onName={(n) => { setVal(n); inputRef.current?.focus(); }} /></div>
          : <input ref={inputRef} className="input" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />)}
        <div className="row end gap">
          <button className="btn ghost" onClick={() => close(false)}>Cancel</button>
          <button className={'btn ' + (d.kind === 'confirm' && d.danger ? 'danger' : 'primary')} onClick={() => close(true)} autoFocus={d.kind === 'confirm'}>{d.ok}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Toasts ---------- */
type ToastAction = { label: string; run: () => unknown };
let toasts: { id: number; text: string; action?: ToastAction }[] = [];
const tl = new Set<() => void>();
const dropToast = (id: number) => { toasts = toasts.filter((t) => t.id !== id); tl.forEach((l) => l()); };
/** A short message; with an action (e.g. Undo) it stays a little longer and has a button */
export function toast(text: string, action?: ToastAction) {
  const id = Math.random();
  toasts = [...toasts, { id, text, action }];
  tl.forEach((l) => l());
  setTimeout(() => dropToast(id), action ? 7000 : 3200);
}
export function ToastHost() {
  const t = useSyncExternalStore((l) => { tl.add(l); return () => tl.delete(l); }, () => toasts);
  return <div className="toasts" role="status" aria-live="polite">{t.map((x) => (
    <div key={x.id} className={'toast' + (x.action ? ' has-action' : '')}>
      {x.text}
      {x.action && <button className="toast-btn" onClick={() => { dropToast(x.id); x.action!.run(); }}>{x.action.label}</button>}
    </div>
  ))}</div>;
}

/* ---------- Context menu ---------- */
export interface MenuItem { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; divider?: boolean; disabled?: boolean; /** smaller grey text after the label */ hint?: string }
let menu: { x: number; y: number; items: MenuItem[] } | null = null;
const ml = new Set<() => void>();
const setMenu = (m: typeof menu) => { menu = m; ml.forEach((l) => l()); };
export function openMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }, items: MenuItem[]) {
  e.preventDefault(); e.stopPropagation();
  setMenu({ x: e.clientX, y: e.clientY, items });
}
/** Open a context menu from the keyboard (Menu key / Shift+F10) next to an element */
export function openMenuAt(el: HTMLElement, items: MenuItem[]) {
  const r = el.getBoundingClientRect();
  openMenu({ clientX: r.left + 24, clientY: r.bottom, preventDefault() {}, stopPropagation() {} }, items);
}

/** Keyboard support for clickable non-button rows: Enter/Space activates, Menu key / Shift+F10 opens the menu */
export function rowKeys(onActivate: () => void, onMenu?: (el: HTMLElement) => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
    if (onMenu && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); onMenu(e.currentTarget); }
  };
}

/** the interface scale (CSS zoom on the page). Mouse positions and getBoundingClientRect are in screen pixels;
 *  divide by this before using them as CSS pixels inside the page */
export const uiZoom = () => parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1;

let menuReturnFocus: HTMLElement | null = null;
export function MenuHost() {
  const m = useSyncExternalStore((l) => { ml.add(l); return () => ml.delete(l); }, () => menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!m) { menuReturnFocus?.focus?.(); menuReturnFocus = null; return; }
    menuReturnFocus = document.activeElement as HTMLElement | null;
    const close = (e: Event) => {
      if (e.type === 'keydown') {
        const k = (e as KeyboardEvent).key;
        const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); btns[(i + (k === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus(); return; }
        if (k === 'Enter' || k === ' ' || k === 'Tab' || k === 'Shift') return;
      }
      setMenu(null);
    };
    // attach after the event that opened the menu has finished (otherwise that same key press closes it)
    const t = setTimeout(() => {
      ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
      window.addEventListener('mousedown', close);
      window.addEventListener('blur', close);
      window.addEventListener('keydown', close);
    }, 0);
    const r = ref.current?.getBoundingClientRect();
    const zoom = uiZoom();
    const x = m.x / zoom, y = m.y / zoom;
    setPos({ x: r ? Math.max(4, Math.min(x, (window.innerWidth - r.width) / zoom - 8)) : x, y: r ? Math.max(4, Math.min(y, (window.innerHeight - r.height) / zoom - 8)) : y });
    return () => { clearTimeout(t); window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', close); };
  }, [m]);
  if (!m) return null;
  return (
    <div ref={ref} className="ctxmenu" role="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      {m.items.map((it, i) => it.divider ? <div key={i} className="sep" role="separator" /> : (
        <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { setMenu(null); it.onClick(); }}>
          <span className="ico">{it.icon}</span><span className="menu-label">{it.label}{it.hint && <span className="menu-hint">{it.hint}</span>}</span>
        </button>
      ))}
    </div>
  );
}

function trapFocus(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Tab') return;
  const f = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useRef('m' + Math.random().toString(36).slice(2)).current;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', k);
    setTimeout(() => { if (!ref.current?.contains(document.activeElement)) (ref.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not(.modal-close)') ?? ref.current)?.focus(); }, 0);
    return () => { window.removeEventListener('keydown', k); if (prev && document.contains(prev)) prev.focus(); };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={trapFocus}>
        <div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-btn modal-close" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export const STATUS_LABEL = { idea: 'Idea', draft: 'Draft', revising: 'Revising', done: 'Done' } as const;
export const STATUS_COLOR = { idea: '#8b8d98', draft: '#e8b14a', revising: '#5fa8f5', done: '#5fbf8f' } as const;
export const CHAPTER_COLORS = ['', '#e06c75', '#e8925a', '#e8c547', '#5fbf8f', '#5fa8f5', '#8b7cf6', '#d17ad8'];
/** the bigger palette in the chapter color picker */
export const COLOR_PALETTE = [
  '#e06c75', '#f0506e', '#e8925a', '#f2a541', '#e8c547', '#c9d64a', '#8bc34a', '#5fbf8f', '#2bb3a3', '#4fc1e9',
  '#5fa8f5', '#4a7ce8', '#8b7cf6', '#a66cff', '#d17ad8', '#f472b6', '#b5876b', '#8d6e63', '#9aa0aa', '#5d6470',
];

/* ---------- name dice: a random made-up name, in the style picked from the little arrow ---------- */
export function NameDice({ onName, size = 15 }: { onName: (name: string) => void; size?: number }) {
  const [style, setStyle] = useState(getNameStyle);
  const label = NAME_STYLES.find((s) => s.id === style)?.label ?? '';
  return (
    <span className="name-dice">
      <button type="button" className="icon-btn" title={`Random ${label.toLowerCase()} name`} aria-label={`Random ${label.toLowerCase()} name`} onClick={() => onName(makeName(style))}><Dices size={size} /></button>
      <button type="button" className="icon-btn name-dice-style" title={`Name style: ${label}`} aria-label="Name style"
        onClick={(e) => openMenu(e, NAME_STYLES.map((s) => ({ label: (s.id === style ? '✓ ' : '') + s.label, hint: s.hint, onClick: () => { setStyle(s.id); setNameStyle(s.id); onName(makeName(s.id)); } })))}>
        <ChevronDown size={12} />
      </button>
    </span>
  );
}

/* ---------- zoom meter: − / slider / + for anyone without a scroll wheel ---------- */
/** `value` is a zoom factor (bigger = closer); the slider moves evenly on a log scale between min and max */
export function ZoomMeter({ value, min, max, onChange, onFit, fitLabel = 'Fit', label, className = '', step = 1.5, fitOn }: {
  value: number; min: number; max: number; onChange: (z: number) => void; onFit?: () => void; fitLabel?: string; label?: string; className?: string; step?: number; fitOn?: boolean;
}) {
  const clamp = (z: number) => Math.max(min, Math.min(max, z));
  const toS = (z: number) => Math.round((Math.log(clamp(z) / min) / Math.log(max / min)) * 1000);
  const fromS = (s: number) => min * Math.pow(max / min, s / 1000);
  return (
    <div className={'zoom-meter ' + className} role="group" aria-label="Zoom" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <button type="button" className="icon-btn sm" title="Zoom out" aria-label="Zoom out" onClick={() => onChange(clamp(value / step))}><Minus size={14} /></button>
      <input type="range" min={0} max={1000} value={toS(value)} aria-label="Zoom level" onChange={(e) => onChange(fromS(+e.target.value))} />
      <button type="button" className="icon-btn sm" title="Zoom in" aria-label="Zoom in" onClick={() => onChange(clamp(value * step))}><Plus size={14} /></button>
      {onFit ? <button type="button" className={'btn ghost sm zoom-fit' + (fitOn ? ' on-text' : '')} onClick={onFit} title="Back to the starting view">{fitLabel}</button> : label ? <span className="zoom-label muted small">{label}</span> : null}
    </div>
  );
}
