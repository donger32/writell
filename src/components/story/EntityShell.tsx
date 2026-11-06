import { useState, type ReactNode } from 'react';
import { Plus, Search, Star, Pin, ChevronRight, ChevronLeft } from 'lucide-react';
import { getNav, go } from '../../nav';
import { openMenu } from '../ui';
import { isPinned, togglePin, useSettings } from '../../settings';
import type { Entity } from '../../db';
import { Avatar } from './common';

/** Two-column layout: searchable list on the left, the open item on the right */
export function EntityShell({ title, items, activeId, onOpen, onNew, newLabel, filters, renderSub, round = true, empty, children, showAvatar = true, parentOf, onNest }: {
  title: string; items: Entity[]; activeId?: string; onOpen: (id: string) => void; onNew: () => void; newLabel: string;
  filters?: ReactNode; renderSub?: (e: Entity) => ReactNode; round?: boolean; empty: ReactNode; children?: ReactNode; showAvatar?: boolean;
  /** when given, the list is shown as a tree (and items can be dragged into each other) */
  parentOf?: (e: Entity) => string | undefined; onNest?: (id: string, parentId: string | undefined) => void;
}) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [dropOn, setDropOn] = useState<string | null>(null);
  useSettings(); // re-render when pins change
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = items
    .filter((e) => terms.every((t) => (e.name + ' ' + e.tags.join(' ') + ' ' + Object.values(e.fields).filter((v) => typeof v === 'string' && !(v as string).startsWith('data:')).join(' ')).toLowerCase().includes(t)))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return (
    <div className={'eshell' + (children ? ' has-open' : '')}>
      <div className="elist">
        <div className="elist-head">
          <h2>{title}</h2>
          <button className="btn primary sm" onClick={onNew}><Plus size={13} /> {newLabel}</button>
        </div>
        <div className="elist-search"><Search size={13} /><input placeholder={`Search ${title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {filters}
        <div className={'elist-items' + (dropOn === '__top' ? ' drop-top' : '')}
          onDragOver={(ev) => { if (onNest && ev.dataTransfer.types.includes('text/x-inkwell-entity')) { ev.preventDefault(); if (ev.target === ev.currentTarget) setDropOn('__top'); } }}
          onDragLeave={(ev) => { if (ev.target === ev.currentTarget) setDropOn(null); }}
          onDrop={(ev) => { if (ev.target !== ev.currentTarget || !onNest) return; const id = ev.dataTransfer.getData('text/x-inkwell-entity'); setDropOn(null); if (id) onNest(id, undefined); }}>
          {(parentOf && !terms.length ? flattenTree(shown, parentOf, closed) : shown.map((e) => ({ e, depth: 0, kids: 0 }))).map(({ e, depth, kids }) => (
            <button key={e.id} className={'eitem' + (e.id === activeId ? ' on' : '') + (dropOn === e.id ? ' drop' : '')} onClick={() => onOpen(e.id)}
              style={depth ? { paddingLeft: 8 + depth * 16 } : undefined}
              draggable={!!onNest}
              onDragStart={(ev) => { ev.dataTransfer.setData('text/x-inkwell-entity', e.id); ev.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(ev) => { if (onNest && ev.dataTransfer.types.includes('text/x-inkwell-entity')) { ev.preventDefault(); ev.stopPropagation(); setDropOn(e.id); } }}
              onDragLeave={() => setDropOn((d) => (d === e.id ? null : d))}
              onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); setDropOn(null); const id = ev.dataTransfer.getData('text/x-inkwell-entity'); if (id && id !== e.id && onNest) onNest(id, e.id); }}
              onContextMenu={(ev) => openMenu(ev, [{ label: isPinned({ kind: 'entity', id: e.id }) ? 'Unpin from sidebar' : 'Pin to sidebar', icon: <Pin size={14} />, onClick: () => togglePin({ projectId: e.projectId, kind: 'entity', id: e.id }) }])}>
              {parentOf && !terms.length && (kids
                ? <span className="tree-toggle" role="button" aria-label={closed[e.id] ? 'Expand' : 'Collapse'} onClick={(ev) => { ev.stopPropagation(); setClosed((c) => ({ ...c, [e.id]: !c[e.id] })); }}><ChevronRight size={12} className={'chev' + (closed[e.id] ? '' : ' open')} /></span>
                : <span className="tree-toggle" />)}
              {showAvatar && <Avatar name={e.name} color={e.fields.color as string | undefined} image={e.fields.image as string | undefined} size={30} round={round} />}
              <span className="col grow" style={{ minWidth: 0 }}>
                <span className="ellipsis strong-ish">{e.name || 'Untitled'}</span>
                {renderSub && <span className="muted small ellipsis">{renderSub(e)}{parentOf && !terms.length && kids ? ` · ${kids} inside` : ''}</span>}
              </span>
              {e.favorite && <Star size={12} className="accent" fill="currentColor" />}
            </button>
          ))}
          {!shown.length && <p className="muted small pad-s">{items.length ? 'No matches.' : 'Nothing here yet.'}</p>}
        </div>
      </div>
      <div className="edetail">
        {children && <button className="phone-back" onClick={() => { const r = getNav().route as Record<string, unknown>; go({ ...r, entityId: undefined } as Parameters<typeof go>[0]); }}><ChevronLeft size={16} /> {title}</button>}
        {children ?? <div className="edetail-empty">{empty}</div>}
      </div>
    </div>
  );
}

/** Small titled box used in the right-hand column of a profile */
export function SideBox({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="sidebox">
      <div className="sidebox-head"><h4>{title}</h4>{action}</div>
      {children}
    </div>
  );
}

/** Depth-first order of a parent/child list; items whose parent isn't in the list sit at the top level */
function flattenTree(items: Entity[], parentOf: (e: Entity) => string | undefined, closed: Record<string, boolean>) {
  const ids = new Set(items.map((e) => e.id));
  const kids = new Map<string, Entity[]>();
  const roots: Entity[] = [];
  for (const e of items) { const p = parentOf(e); if (p && ids.has(p) && p !== e.id) kids.set(p, [...(kids.get(p) ?? []), e]); else roots.push(e); }
  const sort = (a: Entity, b: Entity) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const out: { e: Entity; depth: number; kids: number }[] = [];
  const seen = new Set<string>();
  const walk = (e: Entity, depth: number) => {
    if (seen.has(e.id)) return; seen.add(e.id);
    const k = (kids.get(e.id) ?? []).sort(sort);
    out.push({ e, depth, kids: k.length });
    if (!closed[e.id]) k.forEach((c) => walk(c, depth + 1));
  };
  roots.sort(sort).forEach((r) => walk(r, 0));
  items.filter((e) => !seen.has(e.id)).forEach((e) => walk(e, 0)); // safety for loops
  return out;
}
