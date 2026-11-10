/*
 * Descriptions for chapters and scenes (and projects): a small box that shows a sentence or two
 * when you point at one in the sidebar, cut off with "…" if there's more. Clicking it opens the
 * whole description, where it can also be edited.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';

type Edit = { title: string; value: string; onSave: (v: string) => unknown; rect?: DOMRect };
let edit: Edit | null = null;
const ls = new Set<() => void>();
const setEdit = (e: Edit | null) => { edit = e; ls.forEach((l) => l()); };

/** open the full description editor (next to `rect` when given, otherwise in the middle) */
export const editDescription = (title: string, value: string, onSave: (v: string) => unknown, rect?: DOMRect) => setEdit({ title, value, onSave, rect });

/** the full description, editable; saves as you type */
export function DescEditorHost() {
  const e = useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => edit);
  const [v, setV] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => { if (e) setV(e.value); }, [e]);
  useLayoutEffect(() => {
    const el = ref.current; if (!el || !e) return;
    const w = el.offsetWidth, h = el.offsetHeight, z = parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1;
    if (!e.rect) { setPos({ left: (innerWidth / z - w) / 2, top: Math.max(16, (innerHeight / z - h) / 3) }); return; }
    const r = e.rect;
    setPos({ left: Math.min(r.right / z + 8, innerWidth / z - w - 8), top: Math.max(8, Math.min(r.top / z - 4, innerHeight / z - h - 8)) });
  }, [e]);
  useEffect(() => {
    if (!e) return;
    const away = (ev: MouseEvent) => { if (ref.current && !ref.current.contains(ev.target as Node)) setEdit(null); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setEdit(null); };
    const t = window.setTimeout(() => document.addEventListener('mousedown', away), 0);
    window.addEventListener('keydown', key);
    return () => { window.clearTimeout(t); document.removeEventListener('mousedown', away); window.removeEventListener('keydown', key); };
  }, [e]);
  if (!e) return null;
  return (
    <div ref={ref} className="desc-pop open" role="dialog" aria-label={e.title} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      <div className="row"><strong className="grow small">{e.title}</strong><button className="icon-btn sm" aria-label="Close" onClick={() => setEdit(null)}><X size={13} /></button></div>
      <textarea className="input" autoFocus rows={6} value={v} placeholder="A sentence or two about what happens…"
        onChange={(ev) => { setV(ev.target.value); void e.onSave(ev.target.value); }} />
    </div>
  );
}

/** the short box shown while pointing at a chapter or scene in the sidebar */
export function DescPeek({ text, rect, onOpen, onEnter, onLeave }: { text: string; rect: DOMRect; onOpen: () => void; onEnter: () => void; onLeave: () => void }) {
  const z = parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1;
  return (
    <button className="desc-pop" style={{ left: rect.right / z + 8, top: rect.top / z - 2 }} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onOpen}
      title="Click to see all of it and edit">
      <span className="desc-clamp">{text}</span>
    </button>
  );
}
