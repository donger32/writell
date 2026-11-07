/* Choose a type (worldbuilding category, note type…), add your own, or remove ones you don't use */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, RotateCcw, X } from 'lucide-react';
import { confirmDialog } from '../ui';

export interface TypeOpt { name: string; group?: string }

export function TypePicker({ value, types, countOf, onPick, onAdd, onRemove, onReset, what = 'type' }: {
  value: string; types: TypeOpt[];
  /** how many items use a type (for the remove question) */
  countOf?: (name: string) => number;
  onPick: (name: string) => void; onAdd: (name: string) => void; onRemove: (name: string) => void;
  /** shown when the list differs from the defaults */
  onReset?: () => void; what?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const term = q.trim().toLowerCase();
  const shown = types.filter((t) => !term || t.name.toLowerCase().includes(term));
  const groups = [...new Set(shown.map((t) => t.group ?? ''))];
  const exact = types.some((t) => t.name.toLowerCase() === term);
  const pick = (n: string) => { onPick(n); setOpen(false); setQ(''); };
  const add = () => { const n = q.trim(); if (!n) return; if (!exact) onAdd(n); pick(exact ? types.find((t) => t.name.toLowerCase() === term)!.name : n); };
  const remove = async (n: string) => {
    const c = countOf?.(n) ?? 0;
    if (!(await confirmDialog(`Remove “${n}” from the list?`, c ? `${c} ${c === 1 ? 'item uses' : 'items use'} it. They keep it, but it won't be offered any more. You can add it back any time.` : `It won't be offered any more. You can add it back any time.`, { danger: true, ok: 'Remove' }))) return;
    onRemove(n);
  };
  return (
    <div className="type-picker" ref={box}>
      <button className="pill-select type-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="ellipsis">{value || `Choose a ${what}`}</span><ChevronDown size={13} />
      </button>
      {open && (
        <div className="picker-pop type-pop" role="listbox">
          <div className="picker-search row gap-s">
            <input autoFocus value={q} placeholder={`Find or add a ${what}…`} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          </div>
          <div className="picker-list">
            {groups.map((g) => (
              <div key={g}>
                {g && <div className="picker-group">{g}</div>}
                {shown.filter((t) => (t.group ?? '') === g).map((t) => (
                  <div key={t.name} className={'type-row' + (t.name === value ? ' on' : '')}>
                    <button className="picker-item grow" role="option" aria-selected={t.name === value} onClick={() => pick(t.name)}>{t.name}</button>
                    <button className="type-x" title={`Remove “${t.name}” from the list`} aria-label={`Remove ${t.name}`} onClick={() => void remove(t.name)}><X size={12} /></button>
                  </div>
                ))}
              </div>
            ))}
            {!shown.length && !q.trim() && <p className="muted small pad-s">No {what}s left. Type one above to add it.</p>}
            {q.trim() && !exact && <button className="picker-item accent" onClick={add}><Plus size={13} /> Add “{q.trim()}”</button>}
          </div>
          {onReset && <button className="picker-item muted small type-reset" onClick={async () => { if (await confirmDialog(`Bring back the default ${what}s?`, `Your own ${what}s are kept.`, { ok: 'Bring back' })) onReset(); }}><RotateCcw size={12} /> Bring back the default {what}s</button>}
        </div>
      )}
    </div>
  );
}
