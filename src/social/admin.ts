/*
 * Admin tools (stage D). Every action is checked again by the database
 * (writell_rank), so the buttons only work for staff. Admins never see anyone's
 * writing or chats: those stay encrypted.
 */
import { currentUserId, supabaseClient as sb } from '../sync/engine';
import { forgetProfile, refreshSocial } from './api';
import { notifyFx } from './effects';

const err = (e: { message?: string; code?: string } | null) => {
  if (!e) return null;
  const m = e.message ?? '';
  if (/writell_admin|writell_rank|schema cache|PGRST20/.test(m)) return new Error('The admin tools aren’t set up in Supabase yet: run the stage D setup script.');
  if (/row-level security/.test(m)) return new Error('Only staff can do that.');
  if (/username_shape|reserved_shape|username_check|reserved_name_check/.test(m)) return new Error(/username_check|reserved_name_check/.test(m) ? 'Special names need the special-names setup script in Supabase first.' : 'Names can be 1–24 characters, without spaces.');
  return new Error(m.replace(/^.*?exception: /, '') || 'Something went wrong.');
};
const ok = <T>(r: { data: T; error: { message?: string; code?: string } | null }) => { if (r.error) throw err(r.error); return r.data; };

export interface Overview { accounts: number; profiles: number; new_week: number; online: number; active_week: number; friendships: number; shared_projects: number; messages_today: number; messages: number; banned: number; staff: number }
export const overview = async () => ok(await sb().rpc('writell_admin_overview')) as Overview;

export interface Person {
  id: string; username: string; display_name: string; bio: string; has_avatar: boolean; staff: 'owner' | 'admin' | 'mod' | null; badges: string[];
  name_color: string | null; title: string | null; name_locked: boolean; banned_until: string | null; ban_reason: string | null;
  created_at: string; last_seen: string | null; projects: number; friends: number;
}
export const people = async (q = '') => (ok(await sb().rpc('writell_admin_people', { q })) ?? []) as Person[];

export type Changes = Partial<{ username: string; display_name: string; bio: string; avatar: null; badges: string[]; name_color: string | null; title: string | null; name_locked: boolean; banned_until: string | null; ban_reason: string | null }>;
export async function update(target: string, changes: Changes) {
  ok(await sb().rpc('writell_admin_update', { target, changes }));
  forgetProfile(target);
  if (target === currentUserId()) await refreshSocial();
}
export async function setStaff(target: string, rank: 'admin' | 'mod' | null) { ok(await sb().rpc('writell_admin_set_staff', { target, rank })); forgetProfile(target); }

/* reserved usernames */
export interface Reserved { name: string; note: string }
export const reserved = async () => (ok(await sb().from('writell_reserved').select('name,note').order('name')) ?? []) as Reserved[];
export async function reserve(name: string, note = '') { ok(await sb().from('writell_reserved').insert({ name: name.trim(), note })); }
export async function unreserve(name: string) { ok(await sb().from('writell_reserved').delete().eq('name', name)); }

/* announcements */
export type AnnStyle = 'info' | 'party' | 'warning' | 'love';
export interface Announcement { id: number; text: string; style: AnnStyle; created_at: string; expires_at: string | null; created_by: string }
export const allAnnouncements = async () => (ok(await sb().from('writell_announcements').select('id,text,style,created_at,expires_at,created_by').order('id', { ascending: false }).limit(30)) ?? []) as Announcement[];
export async function announce(text: string, style: AnnStyle, hours: number | null) {
  ok(await sb().from('writell_announcements').insert({ text, style, created_by: currentUserId(), expires_at: hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null }));
  notifyFx();
}
export async function endAnnouncement(id: number) { ok(await sb().from('writell_announcements').delete().eq('id', id)); notifyFx(); }

/* fun effects on people's screens */
export type FxKind = 'confetti' | 'snow' | 'hearts' | 'shout' | 'shake' | 'spotlight';
export async function sendFx(kind: FxKind, target: string | null = null, text: string | null = null) {
  ok(await sb().from('writell_effects').insert({ kind, target, text, created_by: currentUserId() }));
  notifyFx();
}

/* what staff did */
export interface LogRow { id: number; actor: string; target: string | null; action: string; details: string | null; at: string }
export const log = async () => (ok(await sb().from('writell_admin_log').select('id,actor,target,action,details,at').order('id', { ascending: false }).limit(80)) ?? []) as LogRow[];
