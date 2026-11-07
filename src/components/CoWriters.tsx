/* Who else is in this scene right now (live co-writing) */
import { useSyncExternalStore } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { LiveStatus } from '../sync/live';

const COLORS = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#f472b6'];
/** The same color for a person on every screen */
export function userColor(id: string) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORS[Math.abs(h) % COLORS.length]; }

type U = { name: string; color: string };
export function CoWriters({ awareness, status }: { awareness: Awareness; status: LiveStatus | null }) {
  const others = useSyncExternalStore(
    (cb) => { awareness.on('change', cb); return () => awareness.off('change', cb); },
    () => snapshot(awareness),
  );
  const list = JSON.parse(others) as U[];
  const title = status === 'live' ? (list.length ? `Writing live with ${list.map((u) => u.name).join(', ')}` : 'Live: anyone else who opens this scene will appear here')
    : status === 'offline' ? 'Live connection lost: changes still sync every few seconds' : 'Connecting…';
  return (
    <div className={'cowriters ' + (status ?? '')} title={title} aria-label={title}>
      <span className="live-dot" />
      {list.slice(0, 4).map((u, i) => <span key={i} className="co-avatar" style={{ background: u.color }}>{u.name.trim().slice(0, 1).toUpperCase() || '?'}</span>)}
      {list.length > 4 && <span className="co-more">+{list.length - 4}</span>}
    </div>
  );
}
const cache = new WeakMap<Awareness, string>();
function snapshot(a: Awareness): string {
  const users: U[] = [];
  a.getStates().forEach((st, id) => { if (id !== a.clientID && st.user) users.push({ name: String(st.user.name ?? '?'), color: String(st.user.color ?? '#888') }); });
  const s = JSON.stringify(users);
  if (cache.get(a) === s) return cache.get(a)!;
  cache.set(a, s); return s;
}
