/* Share a project: members & roles, adding friends, invite links */
import { useEffect, useState } from 'react';
import { Copy, Crown, Link2, LogOut, Share2, Trash2, UserPlus, X } from 'lucide-react';
import { Modal, confirmDialog, openMenu, toast } from './ui';
import { Avatar } from './story/common';
import { UserName } from './UserName';
import { db } from '../db';
import { go, setNav } from '../nav';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncStatus, useSharedRoles, currentUserId } from '../sync/engine';
import { refreshSocial, useSocial } from '../social/api';
import {
  ROLE_HINT, ROLE_LABEL, acceptInvite, addMember, createInvite, leaveProject, listInvites, listMembers, removeMember, revokeInvite,
  setRole, shareProject, stopSharing, transferOwner, type Invite, type Member, type Role,
} from '../social/share';

type R = Exclude<Role, 'owner'>;
const ROLES: R[] = ['editor', 'commenter', 'viewer'];
const name = (m: Member) => m.profile?.display_name || m.profile?.username || 'Someone';
const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('Link copied: send it to your friend'); } catch { toast('Select the link and copy it'); } };

export function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const sync = useSyncStatus();
  const roles = useSharedRoles();
  const social = useSocial();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const role = roles[projectId];
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<(Invite & { link?: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [friend, setFriend] = useState('');
  const [friendRole, setFriendRole] = useState<R>('editor');
  const [linkRole, setLinkRole] = useState<R>('editor');
  const [newLink, setNewLink] = useState('');
  const owner = role === 'owner';
  const reload = async () => {
    if (!role) return;
    try { setMembers(await listMembers(projectId)); if (owner) setInvites(await listInvites(projectId)); } catch (e) { toast((e as Error).message); }
  };
  useEffect(() => { void reload(); void refreshSocial(); }, [role]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); try { await fn(); if (ok) toast(ok); await reload(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const title = project?.title ?? 'project';

  let body: React.ReactNode;
  if (sync.phase === 'signed-out' || sync.phase === 'needs-recovery') {
    body = <><p>Sharing needs an account, so your friends' copies can stay in sync with yours.</p>
      <button className="btn primary" onClick={() => { onClose(); setNav({ settingsOpen: true, settingsTab: 'account' }); }}>Sign in or create an account</button></>;
  } else if (!role) {
    body = (
      <>
        <p>Share <strong>{title}</strong> with friends. Choose for each one whether they can <strong>edit</strong>, <strong>comment</strong> or just <strong>read</strong>.</p>
        <p className="muted small">It stays private: the project gets its own lock, and only the people you add get the key. Changes reach everyone within a few seconds.</p>
        {!social.me && <p className="small danger-text">Pick a username first (sidebar → Friends).</p>}
        <div><button className="btn primary" disabled={busy || !social.me} onClick={() => act(() => shareProject(projectId), 'Project shared: now add your friends')}><Share2 size={14} /> Start sharing</button></div>
      </>
    );
  } else {
    const inProject = new Set(members?.map((m) => m.user_id));
    const candidates = social.friends.filter((f) => !inProject.has(f.id));
    body = (
      <>
        <h4 className="share-h">People with access</h4>
        {!members ? <p className="muted small">Loading…</p> : (
          <ul className="people share-people">
            {members.map((m) => (
              <li key={m.user_id} className="person">
                <span className="person-main" style={{ cursor: 'var(--cur-default, default)' }}>
                  <Avatar name={name(m)} image={m.profile?.avatar ?? undefined} size={34} />
                  <span className="col" style={{ minWidth: 0 }}>
                    <strong className="ellipsis"><UserName p={m.profile} fallback={name(m)} title={false} />{m.user_id === currentUserId() ? ' (you)' : ''}</strong>
                    <span className="muted small ellipsis">@{m.profile?.username ?? '…'}{m.pending ? ' · joining…' : ''}</span>
                  </span>
                </span>
                <span className="person-actions">
                  {m.role === 'owner' ? <span className="role-pill owner"><Crown size={12} /> Owner</span>
                    : owner ? (
                      <select className="pill-select" value={m.role} disabled={busy} onChange={(e) => act(() => setRole(projectId, m.user_id, e.target.value as R))} aria-label={`Role for ${name(m)}`}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>)
                      : <span className="role-pill">{ROLE_LABEL[m.role]}</span>}
                  {owner && m.role !== 'owner' && (
                    <button className="icon-btn sm" aria-label={`More for ${name(m)}`} onClick={(e) => openMenu(e, [
                      { label: 'Make owner…', icon: <Crown size={14} />, onClick: async () => { if (await confirmDialog(`Make ${name(m)} the owner?`, 'They get full control and you become an editor.', { ok: 'Make owner' })) act(() => transferOwner(projectId, m.user_id), `${name(m)} is now the owner`); } },
                      { label: 'Remove from project', danger: true, icon: <X size={14} />, onClick: async () => { if (await confirmDialog(`Remove ${name(m)}?`, 'The project disappears from their devices.', { danger: true, ok: 'Remove' })) act(() => removeMember(projectId, m.user_id), 'Removed'); } },
                    ])}>⋯</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {owner && (
          <>
            <h4 className="share-h">Add a friend</h4>
            {social.friends.length === 0 ? <p className="muted small">Add friends first (sidebar → Friends), or use an invite link below.</p>
              : candidates.length === 0 ? <p className="muted small">All your friends are already in this project.</p> : (
                <div className="row gap-s wrap">
                  <select className="pill-select" value={friend} onChange={(e) => setFriend(e.target.value)} aria-label="Friend">
                    <option value="">Choose a friend…</option>
                    {candidates.map((f) => <option key={f.id} value={f.id}>{f.display_name || f.username} (@{f.username})</option>)}
                  </select>
                  <select className="pill-select" value={friendRole} onChange={(e) => setFriendRole(e.target.value as R)} aria-label="Their role">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                  <button className="btn primary sm" disabled={!friend || busy} onClick={() => { const f = candidates.find((x) => x.id === friend)!; act(async () => { await addMember(projectId, f, friendRole); setFriend(''); }, `${f.display_name || f.username} can now ${friendRole === 'editor' ? 'edit' : friendRole === 'commenter' ? 'comment on' : 'read'} it`); }}><UserPlus size={13} /> Add</button>
                </div>
              )}
            <p className="muted small">{ROLES.map((r) => `${ROLE_LABEL[r]}: ${ROLE_HINT[r].toLowerCase()}`).join(' · ')}</p>

            <h4 className="share-h">Invite link</h4>
            <p className="muted small">Anyone with the link can join (they need a Writell account). Links stop working after 14 days, or when you turn them off.</p>
            <div className="row gap-s wrap">
              <select className="pill-select" value={linkRole} onChange={(e) => setLinkRole(e.target.value as R)} aria-label="Role for link">{ROLES.map((r) => <option key={r} value={r}>Joins as {ROLE_LABEL[r]}</option>)}</select>
              <button className="btn sm" disabled={busy} onClick={() => act(async () => setNewLink(await createInvite(projectId, linkRole)))}><Link2 size={13} /> Create link</button>
            </div>
            {newLink && <div className="invite-link"><input className="input mono" readOnly value={newLink} onFocus={(e) => e.target.select()} /><button className="btn primary sm" onClick={() => copy(newLink)}><Copy size={13} /> Copy</button></div>}
            {invites.length > 0 && (
              <ul className="invite-list">{invites.map((i) => (
                <li key={i.token} className="row gap-s">
                  <span className="grow small">{ROLE_LABEL[i.role]} link · used {i.uses}× · expires {new Date(i.expires_at).toLocaleDateString()}</span>
                  {i.link && <button className="btn ghost sm" onClick={() => copy(i.link!)}><Copy size={12} /> Copy</button>}
                  <button className="btn ghost sm" onClick={() => act(() => revokeInvite(i.token), 'Link turned off')}>Turn off</button>
                </li>))}
              </ul>
            )}
          </>
        )}
        <div className="share-foot">
          {owner ? (
            <button className="btn ghost sm danger-text" onClick={async () => {
              if (await confirmDialog('Stop sharing this project?', 'Everyone else loses access and it disappears from their devices. You keep it as your own project.', { danger: true, ok: 'Stop sharing' })) { await act(() => stopSharing(projectId), 'No longer shared'); }
            }}><Trash2 size={13} /> Stop sharing</button>
          ) : (
            <button className="btn ghost sm danger-text" onClick={async () => {
              if (await confirmDialog(`Leave “${title}”?`, 'It disappears from your devices. The owner can add you again.', { danger: true, ok: 'Leave project' })) { await act(() => leaveProject(projectId), 'You left the project'); onClose(); go({ view: 'home' }); }
            }}><LogOut size={13} /> Leave project</button>
          )}
        </div>
      </>
    );
  }
  return <Modal title={`Share “${title}”`} onClose={onClose}><div className="pad col gap share-dialog">{body}</div></Modal>;
}

/** Paste an invite link to join a project */
export function JoinDialog({ initial, onClose }: { initial?: string; onClose: () => void }) {
  const sync = useSyncStatus();
  const [text, setText] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const signedOut = sync.phase === 'signed-out' || sync.phase === 'needs-recovery';
  return (
    <Modal title="Join a shared project" onClose={onClose}>
      <div className="pad col gap">
        {signedOut ? <>
          <p>To join, sign in or create a Writell account first. Your invite will be waiting.</p>
          <div><button className="btn primary" onClick={() => setNav({ settingsOpen: true, settingsTab: 'account' })}>Sign in or create an account</button></div>
        </> : <>
          <p className="muted">Paste the invite link your friend sent you.</p>
          <input className="input mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://miosun01.github.io/writell/#invite=…" />
          {msg && <p className="small danger-text">{msg}</p>}
          <div className="row gap-s">
            <button className="btn primary" disabled={busy || !text.trim()} onClick={async () => {
              setBusy(true); setMsg('');
              try { const pid = await acceptInvite(text); clearPendingInvite(); toast('You joined the project'); onClose(); go({ view: 'project', projectId: pid }); }
              catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
            }}>{busy ? 'Joining…' : 'Join project'}</button>
            <button className="btn ghost" onClick={() => { clearPendingInvite(); onClose(); }}>Cancel</button>
          </div>
        </>}
      </div>
    </Modal>
  );
}

const PENDING = 'writell.pendingInvite';
export function takeInviteFromAddress(): string | null {
  if (!/#invite=/.test(location.hash)) { try { return localStorage.getItem(PENDING); } catch { return null; } }
  const link = location.href;
  try { localStorage.setItem(PENDING, link); } catch { /* */ }
  history.replaceState(null, '', location.pathname + location.search); // keep the secret out of the address bar
  return link;
}
export function clearPendingInvite() { try { localStorage.removeItem(PENDING); } catch { /* */ } }
