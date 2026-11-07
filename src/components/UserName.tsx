/* Someone's name with their admin-given extras: color, staff mark, badges, title */
import { Crown, ShieldCheck } from 'lucide-react';
import type { Profile } from '../social/api';
import { badgeOf, roleOf, useCatalog } from '../social/catalog';

export const displayName = (p?: Pick<Profile, 'display_name' | 'username'> | null) => (p ? p.display_name || p.username : 'Someone');

export function StaffMark({ staff, size = 13 }: { staff?: string | null; size?: number }) {
  useCatalog();
  const r = roleOf(staff);
  if (!staff || !r) return null;
  const I = staff === 'owner' ? Crown : ShieldCheck;
  return <span className="staff-mark" style={{ color: r.color }} title={r.name} aria-label={r.name}><I size={size} /></span>;
}

export function Badges({ ids, max = 3 }: { ids?: string[]; max?: number }) {
  useCatalog();
  const list = (ids ?? []).map(badgeOf).filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="badges">
      {list.slice(0, max).map((b) => <span key={b!.id} className="badge-emoji" title={b!.label} aria-label={b!.label}>{b!.emoji}</span>)}
      {list.length > max && <span className="badge-more" title={list.slice(max).map((b) => b!.label).join(', ')}>+{list.length - max}</span>}
    </span>
  );
}

export function UserName({ p, fallback, max = 3, title = true, className }: { p?: Profile | null; fallback?: string; max?: number; title?: boolean; className?: string }) {
  const name = p ? displayName(p) : (fallback ?? 'Someone');
  return (
    <span className={'uname' + (className ? ' ' + className : '')}>
      <span className={'uname-text' + (p?.name_color ? ' nc-' + p.name_color : '')}>{name}</span>
      <StaffMark staff={p?.staff} />
      <Badges ids={p?.badges} max={max} />
      {title && p?.title && <span className="u-title">{p.title}</span>}
    </span>
  );
}
