/*
 * Admin tools (stage D). Every action is checked again by the database
 * (writell_rank), so the buttons only work for staff. Admins never see anyone's
 * writing or chats: those stay encrypted.
 */
import { currentUserId, supabaseClient as sb } from '../sync/engine';
import { forgetProfile, refreshSocial } from './api';
import { notifyFx } from './effects';
import { loadCatalog, type BadgeDef, type RoleDef } from './catalog';

const err = (e: { message?: string; code?: string } | null) => {
  if (!e) return null;
  const m = e.message ?? '';
  if (/writell_admin|writell_rank|schema cache|PGRST20/.test(m)) return new Error('The admin tools aren’t set up in Supabase yet: run the stage D setup script.');
  if (/row-level security/.test(m)) return new Error('Your role isn’t allowed to do that.');
  if (/username_shape|reserved_shape|username_check|reserved_name_check/.test(m)) return new Error(/username_check|reserved_name_check/.test(m) ? 'Special names need the special-names setup script in Supabase first.' : 'Names can be 1–24 characters, without spaces.');
  return new Error(m.replace(/^.*?exception: /, '') || 'Something went wrong.');
};
const ok = <T>(r: { data: T; error: { message?: string; code?: string } | null }) => { if (r.error) throw err(r.error); return r.data; };

export interface Overview { accounts: number; profiles: number; new_week: number; online: number; active_week: number; friendships: number; shared_projects: number; messages_today: number; messages: number; banned: number; staff: number; open_flags?: number }
export const overview = async () => ok(await sb().rpc('writell_admin_overview')) as Overview;

export interface Person {
  id: string; username: string; display_name: string; bio: string; has_avatar: boolean; staff: string | null; badges: string[];
  name_color: string | null; title: string | null; name_locked: boolean; banned_until: string | null; ban_reason: string | null; chat_muted_until?: string | null;
  created_at: string; last_seen: string | null; projects: number; friends: number; open_flags?: number;
}
export const people = async (q = '') => (ok(await sb().rpc('writell_admin_people', { q })) ?? []) as Person[];

export type Changes = Partial<{ username: string; display_name: string; bio: string; avatar: null; badges: string[]; name_color: string | null; title: string | null; name_locked: boolean; banned_until: string | null; ban_reason: string | null; chat_muted_until: string | null }>;
export async function update(target: string, changes: Changes) {
  ok(await sb().rpc('writell_admin_update', { target, changes }));
  forgetProfile(target);
  if (target === currentUserId()) await refreshSocial();
}
export async function setStaff(target: string, rank: string | null) { ok(await sb().rpc('writell_admin_set_staff', { target, rank })); forgetProfile(target); }
export async function wipeMessages(target: string) { return Number(ok(await sb().rpc('writell_admin_wipe_messages', { target })) ?? 0); }

/* roles (owner only) */
export async function saveRole(r: RoleDef) { ok(await sb().from('writell_roles').upsert({ id: r.id, name: r.name, color: r.color, rank: r.rank, perms: r.perms })); await loadCatalog(); }
export async function deleteRole(id: string) { ok(await sb().from('writell_roles').delete().eq('id', id)); await loadCatalog(); }

/* custom badges */
export async function saveBadge(b: Partial<BadgeDef> & { emoji: string; label: string }) {
  const row = { emoji: b.emoji, label: b.label, color: b.color || null, description: b.description || null };
  if (b.id) ok(await sb().from('writell_badges').update(row).eq('id', b.id));
  else ok(await sb().from('writell_badges').insert({ ...row, created_by: currentUserId() }));
  await loadCatalog();
}
export async function deleteBadge(id: string) { ok(await sb().from('writell_badges').delete().eq('id', id)); await loadCatalog(); }

/* name filter & flags */
export type WordLevel = 'block' | 'flag' | 'allow';
export interface Word { word: string; level: WordLevel }
export const words = async () => (ok(await sb().from('writell_name_words').select('word,level').order('word')) ?? []) as Word[];
export async function addWord(word: string, level: WordLevel) { ok(await sb().from('writell_name_words').upsert({ word: word.trim().toLowerCase(), level })); }
export async function removeWord(word: string) { ok(await sb().from('writell_name_words').delete().eq('word', word)); }
export interface Check { level: string; word: string; how: string }
export const checkName = async (n: string) => (ok(await sb().rpc('writell_name_check', { n })) ?? []) as Check[];
export interface Flag { id: number; user_id: string; field: 'username' | 'display_name'; name: string; word: string; how: string; status: 'open' | 'ok' | 'fixed'; created_at: string }
export const flags = async (all = false) => {
  let q = sb().from('writell_name_flags').select('id,user_id,field,name,word,how,status,created_at').order('id', { ascending: false }).limit(200);
  if (!all) q = q.eq('status', 'open');
  return (ok(await q) ?? []) as Flag[];
};
export async function setFlag(id: number, status: 'open' | 'ok' | 'fixed') { ok(await sb().from('writell_name_flags').update({ status, reviewed_by: currentUserId(), reviewed_at: new Date().toISOString() }).eq('id', id)); }
export async function scanNames() { return Number(ok(await sb().rpc('writell_admin_scan_names')) ?? 0); }

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
