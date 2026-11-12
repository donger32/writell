import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { X, Columns2, Pin, PinOff, ArrowRightToLine, ListX, PanelLeft } from 'lucide-react';
import { db } from '../db';
import { useSceneMetasByIds } from '../sceneMeta';
import { closeTab, go, setNav, useNav, getNav } from '../nav';
import { openMenu } from './ui';

/** Open scenes of the current project, like browser tabs (pinned ones stay small at the front) */
export function TabBar({ projectId }: { projectId: string }) {
  const { route, tabs, pinnedTabs } = useNav();
  const scenes = useSceneMetasByIds(tabs);
  const chapters = useLiveQuery(() => db.chapters.where('projectId').equals(projectId).toArray(), [projectId]);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const active = route.view === 'write' ? route.sceneId : '';
  const split = route.view === 'write' ? route.splitSceneId : undefined;

  // keep the open tab in view when there are many
  useEffect(() => { bar.current?.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active, tabs.length]);

  if (!scenes || !chapters) return <div className="tabbar" />;
  const chMap = new Map(chapters.map((c) => [c.id, c]));
  const all = scenes.filter((s): s is NonNullable<typeof s> => !!s && s.projectId === projectId);
  const isPinned = (id: string) => pinnedTabs.includes(id);
  const mine = [...all.filter((s) => isPinned(s.id)), ...all.filter((s) => !isPinned(s.id))];
  if (mine.length <= 1 && !split) return null;
  // the chapter name is only shown when two open scenes share a title
  const dupTitles = new Set(mine.map((s) => s.title).filter((t, i, a) => a.indexOf(t) !== i));

  const open = (id: string) => go({ view: 'write', projectId, sceneId: id, splitSceneId: split !== id ? split : undefined });
  const keepOnly = (keep: (id: string) => boolean) => setNav({ tabs: getNav().tabs.filter((t) => keep(t) || !mine.some((m) => m.id === t)) });
  const drop = (target: string, after: boolean) => {
    if (!drag || drag === target) return;
    const t = getNav().tabs.filter((x) => x !== drag);
    t.splice(t.indexOf(target) + (after ? 1 : 0), 0, drag);
    // dragging into the pinned group pins it, out of it unpins it
    const pins = getNav().pinnedTabs;
    setNav({ tabs: t, pinnedTabs: isPinned(target) ? [...new Set([...pins, drag])] : pins.filter((x) => x !== drag) });
  };

  return (
    <div className="tabbar" role="tablist" ref={bar}
      onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}>
      {mine.map((s, i) => {
        const ch = chMap.get(s.chapterId);
        const pinned = isPinned(s.id);
        const first = mine.findIndex((m) => !isPinned(m.id)) === i && i > 0;
        return (
          <div key={s.id} role="tab" aria-selected={s.id === active}
            className={'tab' + (s.id === active ? ' on' : '') + (s.id === split ? ' split' : '') + (pinned ? ' pinned' : '') + (first ? ' after-pins' : '') + (drag === s.id ? ' dragging' : '')
              + (dropAt?.id === s.id ? (dropAt.after ? ' drop-after' : ' drop-before') : '')}
            style={ch?.color ? { ['--tc' as string]: ch.color } : undefined}
            draggable onDragStart={(e) => { setDrag(s.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDrag(null); setDropAt(null); }}
            onDragOver={(e) => { e.preventDefault(); if (!drag || drag === s.id) return; const r = e.currentTarget.getBoundingClientRect(); setDropAt({ id: s.id, after: e.clientX > r.left + r.width / 2 }); }}
            onDragLeave={() => setDropAt((d) => (d?.id === s.id ? null : d))}
            onDrop={() => { if (dropAt) drop(s.id, dropAt.after); setDropAt(null); }}
            onClick={() => open(s.id)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(s.id); } }}
            onContextMenu={(e) => openMenu(e, [
              { label: pinned ? 'Unpin tab' : 'Pin tab', icon: pinned ? <PinOff size={14} /> : <Pin size={14} />, onClick: () => setNav({ pinnedTabs: pinned ? getNav().pinnedTabs.filter((x) => x !== s.id) : [...getNav().pinnedTabs, s.id] }) },
              { label: 'Open in split view', icon: <Columns2 size={14} />, disabled: !active || active === s.id, onClick: () => { if (active && active !== s.id) go({ view: 'write', projectId, sceneId: active, splitSceneId: s.id }); } },
              { label: 'Show in sidebar', icon: <PanelLeft size={14} />, onClick: () => { open(s.id); window.setTimeout(() => document.querySelector(`.sidebar .tree-row.sc.active`)?.scrollIntoView({ block: 'center' }), 80); } },
              { divider: true, label: '', onClick: () => {} },
              { label: 'Close', icon: <X size={14} />, onClick: () => closeTab(s.id) },
              { label: 'Close other tabs', icon: <ListX size={14} />, onClick: () => { keepOnly((t) => t === s.id || isPinned(t)); open(s.id); } },
              { label: 'Close tabs to the right', icon: <ArrowRightToLine size={14} />, onClick: () => { const right = new Set(mine.slice(i + 1).map((m) => m.id)); keepOnly((t) => !right.has(t) || isPinned(t)); if (right.has(active)) open(s.id); } },
            ])}
            title={`${ch?.title ?? ''} · ${s.title}${s.words ? ` · ${s.words.toLocaleString()} words` : ''}${pinned ? ' (pinned)' : ''}`}>
            <span className="tab-dot" aria-hidden="true" />
            {pinned
              ? <><Pin size={11} className="tab-pin-ico" aria-label="Pinned" /><span className="tab-pin-label ellipsis">{s.title || 'Untitled'}</span></>
              : <span className="ellipsis">{dupTitles.has(s.title) && <span className="muted">{ch?.title} · </span>}{s.title || 'Untitled'}</span>}
            {!pinned && <button className="tab-x" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(s.id); }}><X size={12} /></button>}
          </div>
        );
      })}
    </div>
  );
}

/** Ctrl+Alt+→ / ← moves between open tabs of the current project */
export function useTabKeys() {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      const { route, tabs, pinnedTabs } = getNav(); if (route.view !== 'write') return;
      const sc = await db.scenes.bulkGet(tabs);
      const mine = tabs.filter((t, i) => sc[i]?.projectId === route.projectId);
      const order = [...mine.filter((t) => pinnedTabs.includes(t)), ...mine.filter((t) => !pinnedTabs.includes(t))];
      if (order.length < 2) return;
      e.preventDefault();
      const i = order.indexOf(route.sceneId);
      const next = order[(i + (e.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length];
      go({ view: 'write', projectId: route.projectId, sceneId: next });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
