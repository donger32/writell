/*
 * Staff roles (with their permissions) and custom badges, made by the owner and
 * staff in the admin tools. Everyone signed in can read them, so names show the
 * right colors and badges everywhere.
 */
import { useSyncExternalStore } from 'react';
import { currentUserId, supabaseClient as sb } from '../sync/engine';
import { getSocial } from './api';

export interface RoleDef { id: string; name: string; color: string; rank: number; perms: string[] }
export interface BadgeDef { id: string; emoji: string; label: string; color: string | null; description: string | null }
interface Catalog { roles: RoleDef[]; badges: BadgeDef[]; loaded: boolean }

/** Everything a role can be allowed to do */
export const PERMS: { id: string; label: string; hint: string }[] = [
  { id: 'rename', label: 'Rename people', hint: 'Change usernames and display names, special names, surprise rename' },
  { id: 'lock_names', label: 'Lock names', hint: 'Stop someone changing their name' },
  { id: 'titles_colors', label: 'Titles & name colors', hint: 'Give titles and colored names' },
  { id: 'give_badges', label: 'Give badges', hint: 'Give and take away badges' },
  { id: 'manage_badges', label: 'Make badges', hint: 'Create, edit and delete badges' },
  { id: 'ban', label: 'Ban', hint: 'Ban and unban people' },
  { id: 'moderate_chats', label: 'Manage chats', hint: 'Mute someone in every chat, remove all their messages' },
  { id: 'clear_profiles', label: 'Clear profiles', hint: 'Remove bios and pictures' },
  { id: 'flags', label: 'Flagged names', hint: 'See and handle names the filter flagged' },
  { id: 'filter_words', label: 'Word filter', hint: 'Edit the blocked, flagged and allowed words' },
  { id: 'reserve_names', label: 'Reserve names', hint: 'Reserve usernames nobody can take' },
  { id: 'announce', label: 'Announcements', hint: 'Post banners for everyone' },
  { id: 'effects', label: 'Fun effects', hint: 'Confetti, shouts, spotlight…' },
  { id: 'view_log', label: 'See the log', hint: 'See what staff did' },
];
export const OWNER: RoleDef = { id: 'owner', name: 'Owner', color: '#e8b14a', rank: 1000, perms: PERMS.map((p) => p.id) };

let cat: Catalog = { roles: [], badges: [], loaded: false };
const ls = new Set<() => void>();
export const useCatalog = () => useSyncExternalStore((l) => { ls.add(l); return () => { ls.delete(l); }; }, () => cat, () => cat);
export const getCatalog = () => cat;

let busy: Promise<void> | null = null;
export function loadCatalog(): Promise<void> {
  if (busy) return busy;
  busy = (async () => {
    if (!currentUserId()) return;
    const [r, b] = await Promise.all([
      sb().from('writell_roles').select('id,name,color,rank,perms').order('rank', { ascending: false }),
      sb().from('writell_badges').select('id,emoji,label,color,description').order('created_at', { ascending: true }),
    ]);
    // before the stage E setup script: the old fixed admin / moderator ranks
    const roles = r.error ? [{ id: 'admin', name: 'Admin', color: '#5fa8f5', rank: 200, perms: PERMS.map((p) => p.id) }, { id: 'mod', name: 'Moderator', color: '#5fbf8f', rank: 100, perms: ['rename', 'lock_names', 'give_badges', 'ban'] }] : (r.data ?? []) as RoleDef[];
    cat = { roles, badges: b.error ? [] : (b.data ?? []) as BadgeDef[], loaded: true };
    ls.forEach((l) => l());
  })().finally(() => { busy = null; });
  return busy;
}

export const roleOf = (staff?: string | null): RoleDef | null => (!staff ? null : staff === 'owner' ? OWNER : cat.roles.find((r) => r.id === staff) ?? null);
export const badgeOf = (id: string) => cat.badges.find((b) => b.id === id);
export const rankOf = (staff?: string | null) => roleOf(staff)?.rank ?? (staff ? 1 : 0);
/** Can you (the signed-in person) do this? */
export function can(perm: string) { const r = roleOf(getSocial().me?.staff); return !!r && r.perms.includes(perm); }
