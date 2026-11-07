/*
 * Sharing projects (stage B). The project's key is locked separately for each
 * member with their public key, so only members can read it.
 */
import { db } from '../db';
import { adoptShared, canEdit, currentUserId, forgetShared, sharedKey, sharedRole, supabaseClient as sb, syncNow, type Role } from '../sync/engine';
import { b64url, exportProjectKey, importProjectKey, newProjectKey, openWithSecret, randomBytes, sealFor, sealWithSecret, unb64url } from '../sync/crypto';
import { WEB_APP_URL } from '../sync/config';
import { getProfile, profileQuery, type Profile } from './api';

export type { Role };
export { sharedRole, canEdit };
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Editor', commenter: 'Commenter', viewer: 'Viewer' };
export const ROLE_HINT: Record<Role, string> = {
  owner: 'Full control: members, roles, deleting',
  editor: 'Can write and change everything',
  commenter: 'Can read and leave comments',
  viewer: 'Can read only',
};

const me = () => { const id = currentUserId(); if (!id) throw new Error('Sign in first (Settings → Account & sync).'); return id; };
const err = (e: { message?: string; code?: string } | null) => {
  if (!e) return null;
  const m = e.message ?? '';
  if (/writell_projects|writell_members|schema cache|PGRST20/.test(m)) return new Error('Sharing isn’t set up in Supabase yet: run the stage B setup script.');
  if (/row-level security/.test(m)) return new Error('You’re not allowed to do that (only friends can be added, and only the owner manages members).');
  return new Error(m || 'Something went wrong.');
};
async function myPublicKey(): Promise<string> {
  const p = await getProfile(me());
  if (!p) throw new Error('Pick a username first (sidebar → Friends).');
  if (!p.public_key) throw new Error('Your profile is still being set up. Open Friends once, then try again.');
  return p.public_key;
}

/** Turn one of your projects into a shared project (you become its owner) */
export async function shareProject(pid: string) {
  if (sharedRole(pid)) return;
  const uid = me();
  const pub = await myPublicKey();
  const { key, raw } = await newProjectKey();
  const a = await sb().from('writell_projects').insert({ id: pid, owner: uid });
  if (a.error && a.error.code !== '23505') throw err(a.error);
  const b = await sb().from('writell_members').insert({ project_id: pid, user_id: uid, role: 'owner', key_grant: await sealFor(pub, raw) });
  if (b.error) throw err(b.error);
  await adoptShared(pid, 'owner', key);
}

export interface Member { user_id: string; role: Role; profile: Profile | null; pending: boolean }
export async function listMembers(pid: string): Promise<Member[]> {
  const { data, error } = await sb().from('writell_members').select('user_id,role,key_grant').eq('project_id', pid);
  if (error) throw err(error);
  const rows = (data ?? []) as { user_id: string; role: Role; key_grant: string | null }[];
  const ids = rows.map((r) => r.user_id);
  const { data: profs } = ids.length ? await profileQuery((c) => sb().from('writell_profiles').select(c).in('id', ids)) : { data: [] };
  const by = new Map(((profs ?? []) as unknown as Profile[]).map((p) => [p.id, p]));
  const order: Role[] = ['owner', 'editor', 'commenter', 'viewer'];
  return rows.map((r) => ({ user_id: r.user_id, role: r.role, profile: by.get(r.user_id) ?? null, pending: !r.key_grant }))
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}

/** Add a friend straight away with a role */
export async function addMember(pid: string, friend: Profile, role: Exclude<Role, 'owner'>) {
  if (!friend.public_key) throw new Error(`${friend.display_name || friend.username} needs to open Writell's Friends page once before you can share with them.`);
  const key = sharedKey(pid); if (!key) throw new Error('Share the project first.');
  const grant = await sealFor(friend.public_key, await exportProjectKey(key));
  const { error } = await sb().from('writell_members').insert({ project_id: pid, user_id: friend.id, role, key_grant: grant });
  if (error) throw err(error);
}
export async function setRole(pid: string, userId: string, role: Exclude<Role, 'owner'>) {
  const { error } = await sb().from('writell_members').update({ role }).eq('project_id', pid).eq('user_id', userId);
  if (error) throw err(error);
}
export async function removeMember(pid: string, userId: string) {
  const { error } = await sb().from('writell_members').delete().eq('project_id', pid).eq('user_id', userId);
  if (error) throw err(error);
}
export async function transferOwner(pid: string, userId: string) {
  const { error } = await sb().rpc('writell_transfer_owner', { p: pid, new_owner: userId });
  if (error) throw err(error);
  await syncNow();
}
/** Leave a project someone shared with you: it's removed from your devices */
export async function leaveProject(pid: string) {
  const { error } = await sb().from('writell_members').delete().eq('project_id', pid).eq('user_id', me());
  if (error) throw err(error);
  await forgetShared(pid, false);
}
/** Owner: stop sharing. Everyone else loses access; you keep it as your own project. */
export async function stopSharing(pid: string) {
  const { error } = await sb().from('writell_projects').delete().eq('id', pid);
  if (error) throw err(error);
  await forgetShared(pid, true);
}

/* ---------------- invite links ---------------- */
export interface Invite { token: string; role: Role; created_at: string; expires_at: string; uses: number }
export async function createInvite(pid: string, role: Exclude<Role, 'owner'>): Promise<string> {
  const key = sharedKey(pid); if (!key) throw new Error('Share the project first.');
  const token = b64url(randomBytes(12)), secret = randomBytes(32);
  const key_wrap = await sealWithSecret(secret, await exportProjectKey(key));
  const { error } = await sb().from('writell_invites').insert({ token, project_id: pid, role, key_wrap, created_by: me() });
  if (error) throw err(error);
  const link = `${WEB_APP_URL}#invite=${token}.${b64url(secret)}`;
  remember(token, link);
  return link;
}
export async function listInvites(pid: string): Promise<(Invite & { link?: string })[]> {
  const { data, error } = await sb().from('writell_invites').select('token,role,created_at,expires_at,uses').eq('project_id', pid);
  if (error) throw err(error);
  return ((data ?? []) as Invite[]).filter((i) => Date.parse(i.expires_at) > Date.now()).map((i) => ({ ...i, link: recall(i.token) }));
}
export async function revokeInvite(token: string) {
  const { error } = await sb().from('writell_invites').delete().eq('token', token);
  if (error) throw err(error);
}
// the secret half of a link is never stored on the server; keep your own links on this device so you can copy them again
const LINKS = 'writell.inviteLinks';
function remember(token: string, link: string) { try { const m = JSON.parse(localStorage.getItem(LINKS) || '{}'); m[token] = link; localStorage.setItem(LINKS, JSON.stringify(m)); } catch { /* */ } }
function recall(token: string): string | undefined { try { return JSON.parse(localStorage.getItem(LINKS) || '{}')[token]; } catch { return undefined; } }

/** Pull "token.secret" out of a link (or the bit after #invite=) */
export function parseInvite(text: string): { token: string; secret: string } | null {
  const m = text.trim().match(/invite=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/) ?? text.trim().match(/^([A-Za-z0-9_-]{10,})\.([A-Za-z0-9_-]{30,})$/);
  return m ? { token: m[1], secret: m[2] } : null;
}
/** Join a project with an invite link. Returns the project id. */
export async function acceptInvite(text: string): Promise<string> {
  const inv = parseInvite(text); if (!inv) throw new Error('That doesn’t look like a Writell invite link.');
  const { data, error } = await sb().rpc('writell_accept_invite', { t: inv.token });
  if (error) throw new Error(/expired|turned off/.test(error.message) ? error.message : err(error)!.message);
  const res = data as { project_id: string; role: Role; key_wrap: string };
  let raw: Uint8Array;
  try { raw = await openWithSecret(unb64url(inv.secret), res.key_wrap); } catch { throw new Error('This invite link is incomplete. Ask for it again and copy the whole link.'); }
  const { error: e2 } = await sb().rpc('writell_set_my_grant', { p: res.project_id, g: await sealFor(await myPublicKey(), raw) });
  if (e2) throw err(e2);
  await adoptShared(res.project_id, res.role, await importProjectKey(raw), true);
  return res.project_id;
}

/** Who owns a shared project (for "Shared by …") */
export async function projectOwner(pid: string): Promise<Profile | null> {
  const { data } = await sb().from('writell_members').select('user_id').eq('project_id', pid).eq('role', 'owner').maybeSingle();
  const id = (data as { user_id?: string } | null)?.user_id;
  return id ? getProfile(id) : null;
}
export const hasLocalProject = async (pid: string) => !!(await db.projects.get(pid));
