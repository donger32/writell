import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { X, Columns2 } from 'lucide-react';
import { db } from '../db';
import { closeTab, go, setNav, useNav, getNav } from '../nav';
import { openMenu } from './ui';

/** Open scenes of the current project, like browser tabs */
export function TabBar({ projectId }: { projectId: string }) {
  const { route, tabs } = useNav();
  const scenes = useLiveQuery(() => db.scenes.bulkGet(tabs), [tabs.join()]);
  const chapters = useLiveQuery(() => db.chapters.where('projectId').equals(projectId).toArray(), [projectId]);
  const [drag, setDrag] = useState<string | null>(null);
  if (!scenes || !chapters) return <div className="tabbar" />;
  const chMap = new Map(chapters.map((c) => [c.id, c]));
  const mine = scenes.filter((s): s is NonNullable<typeof s> => !!s && s.projectId === projectId);
  const active = route.view === 'write' ? route.sceneId : '';
  const split = route.view === 'write' ? route.splitSceneId : undefined;
  if (mine.length <= 1 && !split) return null;

  return (
    <div className="tabbar" role="tablist">
      {mine.map((s) => {
        const ch = chMap.get(s.chapterId);
        return (
          <div key={s.id} role="tab" aria-selected={s.id === active}
            className={'tab' + (s.id === active ? ' on' : '') + (s.id === split ? ' split' : '')}
            draggable onDragStart={() => setDrag(s.id)} onDragEnd={() => setDrag(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!drag || drag === s.id) return;
              const t = getNav().tabs.filter((x) => x !== drag);
              t.splice(t.indexOf(s.id), 0, drag);
              setNav({ tabs: t });
            }}
            onClick={() => go({ view: 'write', projectId, sceneId: s.id, splitSceneId: split !== s.id ? split : undefined })}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(s.id); } }}
            onContextMenu={(e) => openMenu(e, [
              { label: 'Open in split view', icon: <Columns2 size={14} />, onClick: () => { if (active && active !== s.id) go({ view: 'write', projectId, sceneId: active, splitSceneId: s.id }); } },
              { label: 'Close', icon: <X size={14} />, onClick: () => closeTab(s.id) },
              { label: 'Close other tabs', onClick: () => { setNav({ tabs: getNav().tabs.filter((t) => t === s.id || !mine.some((m) => m.id === t)) }); go({ view: 'write', projectId, sceneId: s.id }); } },
            ])}
            title={`${ch?.title ?? ''} · ${s.title}`}>
            {ch?.color && <span className="dot" style={{ background: ch.color }} />}
            <span className="ellipsis"><span className="muted">{ch?.title} · </span>{s.title}</span>
            <button className="tab-x" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(s.id); }}><X size={12} /></button>
          </div>
        );
      })}
    </div>
  );
}
