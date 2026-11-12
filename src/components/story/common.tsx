import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, Plus, ImagePlus, Search, Settings2 } from 'lucide-react';
import { db, type Entity } from '../../db';
import { useSceneMetas } from '../../sceneMeta';
import { registerFlush } from '../../saveRegistry';
import { NAME_COLORS, autoColor, initials, pickImage, PLACE_CATEGORIES } from '../../entities';

/** Text field that keeps local state and commits debounced (no cursor jumps) */
export function Field({ label, value, onCommit, long, wrap, placeholder, className }: { label?: string; value: string; onCommit: (v: string) => void; long?: boolean; /** one line of text that wraps instead of scrolling (titles) */ wrap?: boolean; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!dirty.current) setV(value); }, [value]);
  const commit = (x: string) => { window.clearTimeout(timer.current); dirty.current = false; onCommit(x); };
  const change = (x: string) => {
    setV(x); dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commit(x), 400);
  };
  const latest = useRef(v); latest.current = v;
  const commitRef = useRef(onCommit); commitRef.current = onCommit;
  useEffect(() => {
    const flush = () => { if (dirty.current) { window.clearTimeout(timer.current); dirty.current = false; return commitRef.current(latest.current); } };
    const unreg = registerFlush(flush);
    return () => { flush(); unreg(); };
  }, []);
  useLayoutEffect(() => {
    const t = ref.current;
    if (t && (long || wrap)) { t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight, wrap ? 0 : 34) + 'px'; }
  }, [v, long, wrap]);
  return (
    <label className={'sfield ' + (className ?? '')}>
      {label && <span>{label}</span>}
      {wrap ? (
        <textarea ref={ref} className="input auto" rows={1} value={v} placeholder={placeholder} spellCheck onChange={(e) => change(e.target.value.replace(/[\r\n]+/g, ' '))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} onBlur={(e) => dirty.current && commit(e.target.value)} />
      ) : long ? (
        <textarea ref={ref} className="input auto" rows={1} value={v} placeholder={placeholder} spellCheck onChange={(e) => change(e.target.value)} onBlur={(e) => dirty.current && commit(e.target.value)} />
      ) : (
        <input className="input" ref={ref as unknown as React.RefObject<HTMLInputElement>} value={v} placeholder={placeholder} spellCheck onChange={(e) => change(e.target.value)} onBlur={(e) => dirty.current && commit(e.target.value)} />
      )}
    </label>
  );
}

export function TagEditor({ tags, onChange, suggestions = [], onManage }: { tags: string[]; onChange: (t: string[]) => void; suggestions?: string[]; onManage?: () => void }) {
  const [v, setV] = useState('');
  const [open, setOpen] = useState(false);
  const add = (t: string) => { const x = t.trim().replace(/^#/, ''); if (x && !tags.includes(x)) onChange([...tags, x]); setV(''); };
  const term = v.trim().replace(/^#/, '').toLowerCase();
  const offer = [...new Set(suggestions)].filter((s) => !tags.includes(s) && (!term || s.toLowerCase().includes(term))).slice(0, 8);
  return (
    <div className="tags">
      {tags.map((t) => <span key={t} className="tag">#{t}<button aria-label={`Remove ${t}`} title={`Remove #${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}><X size={11} /></button></span>)}
      <span className="tag-add-wrap">
        {open ? (
          <input className="tag-input" autoFocus value={v} placeholder="Tag name…" aria-label="Add a tag" onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (v.trim()) add(v); else setOpen(false); } if (e.key === 'Escape') { setV(''); setOpen(false); } if (e.key === 'Backspace' && !v && tags.length) onChange(tags.slice(0, -1)); }}
            onBlur={() => { setTimeout(() => { setV((cur) => { if (cur.trim()) add(cur); return ''; }); setOpen(false); }, 150); }} />
        ) : (
          <button type="button" className="tag-add" onClick={() => setOpen(true)}><Plus size={11} /> Add tag</button>
        )}
        {open && (offer.length > 0 || term) && (
          <div className="tag-pop" onMouseDown={(e) => e.preventDefault()}>
            {offer.map((s) => <button key={s} type="button" onClick={() => add(s)}>#{s}</button>)}
            {term && !suggestions.some((s) => s.toLowerCase() === term) && !tags.some((s) => s.toLowerCase() === term) && <button type="button" className="accent" onClick={() => add(v)}><Plus size={11} /> New tag “{v.trim().replace(/^#/, '')}”</button>}
          </div>
        )}
      </span>
      {onManage && <button type="button" className="tag-manage" title="Add, rename or remove tags" onClick={onManage}><Settings2 size={12} /></button>}
    </div>
  );
}

/** Avatar: the picture, or initials on the item's colour (chosen on its page, else picked from its name) */
export function Avatar({ name, image, size = 36, round = true, color }: { name: string; image?: string; size?: number; round?: boolean; color?: string }) {
  const c = color || autoColor(name);
  return image
    ? <img className="avatar" src={image} alt="" draggable={false} style={{ width: size, height: size, borderRadius: round ? '50%' : 8, ['--av' as string]: c }} />
    : <span className="avatar ph" style={{ width: size, height: size, borderRadius: round ? '50%' : 8, fontSize: size * (initials(name).length > 2 ? 0.3 : 0.38), ['--av' as string]: c }}>{initials(name)}</span>;
}

export function ImageBox({ image, name, onChange, round, size = 120, color }: { image?: string; name: string; onChange: (v: string | null) => void; round?: boolean; size?: number; color?: string }) {
  return (
    <div className="imagebox" style={{ width: size, height: size, borderRadius: round ? '50%' : 12, ['--av' as string]: color || autoColor(name) }}>
      {image ? <img src={image} alt="" draggable={false} /> : <span className="ph-big">{initials(name)}</span>}
      <div className="imagebox-actions">
        <button title="Choose image" onClick={async () => { const d = await pickImage(); if (d) onChange(d); }}><ImagePlus size={15} /></button>
        {image && <button title="Remove image" onClick={() => onChange(null)}><X size={15} /></button>}
      </div>
    </div>
  );
}

/** A toolbar button that opens a small panel (closes on outside click / Escape) */
export function PopButton({ icon, label, badge, wide, children }: { icon?: React.ReactNode; label: string; badge?: number; wide?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.ctxmenu')) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="popbtn" ref={ref}>
      <button className={'btn ghost sm' + (open ? ' on' : '')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{icon}{label}{badge ? <span className="pop-badge">{badge}</span> : null}</button>
      {open && <div className={'pop-panel' + (wide ? ' wide' : '')} role="dialog" aria-label={label}>{children}</div>}
    </div>
  );
}

/** A colour dot that opens a small palette ("Automatic" = picked from the name) */
export function ColorPick({ value, auto, onChange }: { value?: string; auto: string; onChange: (c: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); };
  }, [open]);
  const cur = value || auto;
  return (
    <div className="colorpick" ref={ref}>
      <button className="pill-select colorpick-btn" onClick={() => setOpen((o) => !o)} aria-label="Name color" title="Name color: used for their avatar, their name in your text, timelines and maps">
        <span className="swatch" style={{ background: cur }} /> Color
      </button>
      {open && (
        <div className="colorpick-pop" role="dialog" aria-label="Choose a color">
          <div className="swatches">
            {NAME_COLORS.map((c) => (
              <button key={c} className={'swatch big' + (value === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => { onChange(c); setOpen(false); }} />
            ))}
            <label className="swatch big custom" title="Any color" style={{ background: value && !NAME_COLORS.includes(value) ? value : undefined }}>
              <input type="color" value={cur} onChange={(e) => onChange(e.target.value)} aria-label="Any color" />+
            </label>
          </div>
          <button className={'btn ghost sm' + (!value ? ' on' : '')} onClick={() => { onChange(undefined); setOpen(false); }}><span className="swatch" style={{ background: auto }} /> Automatic</button>
        </div>
      )}
    </div>
  );
}

export interface PickOption { id: string; label: string; sub?: string; image?: string; group?: string }

/** Small searchable dropdown used to link things together */
export function Picker({ options, onPick, onCreate, placeholder = 'Search…', buttonLabel = 'Add', exclude = [] }: { options: PickOption[]; onPick: (id: string) => void; onCreate?: (name: string) => void; placeholder?: string; buttonLabel?: string; exclude?: string[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [side, setSide] = useState<'left' | 'right'>('right');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const list = options.filter((o) => !exclude.includes(o.id) && (o.label + ' ' + (o.sub ?? '')).toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  return (
    <div className="picker" ref={ref}>
      <button className="btn ghost sm" onClick={() => {
        // open towards whichever side of the window has room
        const r = ref.current?.getBoundingClientRect();
        setSide(r && r.left + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right');
        setOpen(!open); setQ('');
      }}><Plus size={13} /> {buttonLabel}</button>
      {open && (
        <div className="picker-pop" style={side === 'left' ? { left: 0, right: 'auto' } : { right: 0, left: 'auto' }}>
          <div className="row gap-s picker-search"><Search size={13} className="muted" /><input autoFocus value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter') { if (list[0]) { onPick(list[0].id); setOpen(false); } else if (onCreate && q.trim()) { onCreate(q.trim()); setOpen(false); } } }} /></div>
          <div className="picker-list">
            {list.map((o, i) => (
              <div key={o.id}>
                {o.group && o.group !== list[i - 1]?.group && <div className="picker-group">{o.group}</div>}
                <button className="picker-item" onClick={() => { onPick(o.id); setOpen(false); }}>
                  {o.image !== undefined && <Avatar name={o.label} image={o.image} size={20} />}
                  <span className="grow ellipsis">{o.label}</span>{o.sub && <span className="muted small ellipsis">{o.sub}</span>}
                </button>
              </div>
            ))}
            {onCreate && q.trim() && !list.some((o) => o.label.toLowerCase() === q.trim().toLowerCase()) && (
              <button className="picker-item accent" onClick={() => { onCreate(q.trim()); setOpen(false); }}><Plus size={13} /> Create “{q.trim()}”</button>
            )}
            {!list.length && !(onCreate && q.trim()) && <div className="muted small pad-s">Nothing to add.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Options for everything linkable inside a project */
export function useProjectOptions(projectId: string) {
  const metas = useSceneMetas(projectId);
  return useLiveQuery(async () => {
    if (!metas) return undefined;
    const scenes = metas.slice();
    const [entities, chapters] = await Promise.all([
      db.entities.where('projectId').equals(projectId).toArray(),
      db.chapters.where('projectId').equals(projectId).sortBy('order'),
    ]);
    const chMap = new Map(chapters.map((c, i) => [c.id, { c, i }]));
    const sceneOpts: PickOption[] = scenes
      .sort((a, b) => ((chMap.get(a.chapterId)?.i ?? 1e9) - (chMap.get(b.chapterId)?.i ?? 1e9)) || a.order - b.order) // a scene can outlive its chapter (sync, old deletes)
      .map((s) => ({ id: s.id, label: `${chMap.get(s.chapterId)?.c.title ?? 'No chapter'} · ${s.title}`, group: 'Scenes' }));
    const ent = (kind: string) => entities.filter((e) => e.kind === kind).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return {
      entities,
      byId: new Map(entities.map((e) => [e.id, e])),
      scenes, chapters, sceneOpts,
      characterOpts: ent('character').map((e): PickOption => ({ id: e.id, label: e.name, sub: String(e.fields.role ?? ''), image: String(e.fields.image ?? ''), group: 'Characters' })),
      worldOpts: ent('world').map((e): PickOption => ({ id: e.id, label: e.name, sub: String(e.fields.category ?? ''), group: 'World' })),
      placeOpts: ent('world').filter((e) => isPlace(e)).map((e): PickOption => ({ id: e.id, label: e.name, sub: String(e.fields.category ?? ''), group: 'Places' })),
      chapterOpts: chapters.map((c): PickOption => ({ id: c.id, label: c.title, group: 'Chapters' })),
      noteOpts: ent('note').map((e): PickOption => ({ id: e.id, label: e.name, group: 'Notes' })),
      allTags: [...new Set(entities.flatMap((e) => e.tags))].sort(),
    };
  }, [projectId, metas]);
}

export const isPlace = (e: Entity) => PLACE_CATEGORIES.has(String(e.fields.category ?? ''));
