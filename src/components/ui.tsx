import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

/* ---------- Promise-based dialogs (native confirm/prompt are unreliable in desktop webviews) ---------- */

type Dialog =
  | { kind: 'confirm'; title: string; body?: string; danger?: boolean; ok: string; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; value: string; ok: string; resolve: (v: string | null) => void };

let dialog: Dialog | null = null;
const dl = new Set<() => void>();
const setDialog = (d: Dialog | null) => { dialog = d; dl.forEach((l) => l()); };

export const confirmDialog = (title: string, body?: string, opts: { danger?: boolean; ok?: string } = {}) =>
  new Promise<boolean>((resolve) => setDialog({ kind: 'confirm', title, body, danger: opts.danger, ok: opts.ok ?? 'OK', resolve }));

export const promptDialog = (title: string, value = '', ok = 'Save') =>
  new Promise<string | null>((resolve) => setDialog({ kind: 'prompt', title, value, ok, resolve }));

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
        {d.kind === 'prompt' && <input ref={inputRef} className="input" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />}
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
export interface MenuItem { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; divider?: boolean; /** smaller grey text after the label */ hint?: string }
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
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1;
    const x = m.x / zoom, y = m.y / zoom;
    setPos({ x: r ? Math.min(x, window.innerWidth / zoom - r.width - 8) : x, y: r ? Math.min(y, window.innerHeight / zoom - r.height - 8) : y });
    return () => { clearTimeout(t); window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', close); };
  }, [m]);
  if (!m) return null;
  return (
    <div ref={ref} className="ctxmenu" role="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      {m.items.map((it, i) => it.divider ? <div key={i} className="sep" role="separator" /> : (
        <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { setMenu(null); it.onClick(); }}>
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
