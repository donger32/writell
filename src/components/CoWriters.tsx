/* Who else is in this scene (and elsewhere in the project) right now; click someone to follow them */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Crosshair, MessagesSquare } from 'lucide-react';
import type { Awareness } from 'y-protocols/awareness';
import type { LiveStatus } from '../sync/live';
import { follow, unfollow, useFollowing, useProjectPeople } from '../social/presence';
import { getProfiles, type Profile } from '../social/api';
import { db } from '../db';
import { openMenu, toast } from './ui';

const COLORS = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#f472b6'];
/** The same color for a person on every screen */
export function userColor(id: string) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORS[Math.abs(h) % COLORS.length]; }

type U = { name: string; color: string; id?: string };
export function CoWriters({ awareness, status, projectId, sceneId, onChat }: { awareness: Awareness; status: LiveStatus | null; projectId: string; sceneId: string; onChat?: () => void }) {
  const others = useSyncExternalStore(
    (cb) => { awareness.on('change', cb); return () => awareness.off('change', cb); },
    () => snapshot(awareness),
  );
  const inScene = JSON.parse(others) as U[];
  const people = useProjectPeople(projectId);
  const following = useFollowing();
  const ids = new Set(inScene.map((u) => u.id).filter(Boolean));
  const elsewhere = people.filter((w) => !ids.has(w.u));
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const key = elsewhere.map((w) => w.u).join();
  useEffect(() => { if (key) void getProfiles(key.split(',')).then(setProfiles); }, [key]);
  const nameOf = (id: string) => { const p = profiles.get(id); return p ? p.display_name || p.username : 'Someone'; };

  const title = status === 'live' ? (inScene.length ? `Writing live with ${inScene.map((u) => u.name).join(', ')}` : 'Live: anyone else who opens this scene will appear here')
    : status === 'offline' ? 'Live connection lost: changes still sync every few seconds' : 'Connecting…';
  const menu = async (e: React.MouseEvent, id: string | undefined, name: string, scene: string | null) => {
    if (!id) return;
    const sceneTitle = scene && scene !== sceneId ? (await db.scenes.get(scene))?.title : null;
    openMenu(e, [
      following?.u === id
        ? { label: `Stop following ${name}`, icon: <Crosshair size={14} />, onClick: () => unfollow() }
        : { label: `Follow ${name}`, icon: <Crosshair size={14} />, onClick: () => { follow(projectId, id); toast(`Following ${name}${sceneTitle ? ` to “${sceneTitle}”` : ''}: you’ll see where they write`); } },
      ...(onChat ? [{ label: 'Open chat', icon: <MessagesSquare size={14} />, onClick: onChat }] : []),
    ]);
  };
  return (
    <div className={'cowriters ' + (status ?? '')} title={title} aria-label={title}>
      <span className="live-dot" />
      {inScene.slice(0, 4).map((u, i) => (
        <button key={u.id ?? i} className={'co-avatar' + (following?.u === u.id ? ' following' : '')} style={{ background: u.color }} title={`${u.name} (in this scene)${u.id ? ': click to follow' : ''}`} onClick={(e) => void menu(e, u.id, u.name, sceneId)}>
          {u.name.trim().slice(0, 1).toUpperCase() || '?'}
        </button>
      ))}
      {inScene.length > 4 && <span className="co-more">+{inScene.length - 4}</span>}
      {elsewhere.slice(0, 3).map((w) => (
        <button key={w.u} className={'co-avatar away' + (following?.u === w.u ? ' following' : '')} style={{ background: userColor(w.u) }} title={`${nameOf(w.u)} is elsewhere in this project: click to follow`} onClick={(e) => void menu(e, w.u, nameOf(w.u), w.scene)}>
          {nameOf(w.u).trim().slice(0, 1).toUpperCase() || '?'}
        </button>
      ))}
    </div>
  );
}
const cache = new WeakMap<Awareness, string>();
function snapshot(a: Awareness): string {
  const users: U[] = [];
  a.getStates().forEach((st, id) => { if (id !== a.clientID && st.user) users.push({ name: String(st.user.name ?? '?'), color: String(st.user.color ?? '#888'), id: st.user.id ? String(st.user.id) : undefined }); });
  const s = JSON.stringify(users);
  if (cache.get(a) === s) return cache.get(a)!;
  cache.set(a, s); return s;
}
