/* Friends & people: your profile, friends, requests, finding people, blocked */
import { useEffect, useRef, useState } from 'react';
import { Ban, Check, Search, UserMinus, UserPlus, Users, X, Pencil, Cloud } from 'lucide-react';
import {
  accept, block, friendsSince, getProfile, isBanned, isOnline, refreshSocial, relationTo, saveProfile, searchPeople, sendRequest, setShowOnline,
  unblock, unfriend, usernameTaken, useSocial, USERNAME_RE, type Profile,
} from '../social/api';
import { useSyncStatus } from '../sync/engine';
import { setNav } from '../nav';
import { Avatar, ImageBox } from './story/common';
import { pickImage } from '../entities';
import { Modal, confirmDialog, toast } from './ui';
import { timeAgo } from '../util';
import { UserName } from './UserName';
import { STAFF_LABEL, badge } from '../social/badges';
import { MuteButton } from './MuteButton';

type Tab = 'friends' | 'requests' | 'find' | 'blocked';
const nameOf = (p: Profile) => p.display_name || p.username;
const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast((e as Error).message); } };

export function FriendsView() {
  const sync = useSyncStatus();
  const s = useSocial();
  const [tab, setTab] = useState<Tab>('friends');
  const [open, setOpen] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { void refreshSocial(); }, [sync.phase]);
  useEffect(() => { if (s.incoming.length && tab === 'friends' && !s.friends.length) setTab('requests'); }, [s.incoming.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sync.phase === 'signed-out' || sync.phase === 'needs-recovery') {
    return (
      <div className="page friends-page">
        <div className="empty-card">
          <Users size={28} className="accent" />
          <h3>Friends</h3>
          <p className="muted">Add friends to share projects and write together. First, sign in or create an account. It also keeps your projects synced between your devices.</p>
          <button className="btn primary" onClick={() => setNav({ settingsOpen: true, settingsTab: 'account' })}><Cloud size={14} /> Sign in or create an account</button>
        </div>
      </div>
    );
  }
  if (!s.ready) return <div className="page"><p className="muted">Loading…</p></div>;
  if (s.error && !s.me) return <div className="page"><div className="empty-card"><h3>Friends</h3><p className="danger-text">{s.error}</p><button className="btn" onClick={() => refreshSocial()}>Try again</button></div></div>;
  if (!s.me) return <div className="page friends-page"><ProfileEditor first onDone={() => {}} /></div>;

  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'friends', label: 'Friends', n: s.friends.length },
    { id: 'requests', label: 'Requests', n: s.incoming.length + s.outgoing.length },
    { id: 'find', label: 'Find people' },
    ...(s.blocked.length ? [{ id: 'blocked' as Tab, label: 'Blocked', n: s.blocked.length }] : []),
  ];
  return (
    <div className="page friends-page">
      <header className="me-card">
        <Avatar name={nameOf(s.me)} image={s.me.avatar ?? undefined} size={56} />
        <div className="col grow" style={{ minWidth: 0 }}>
          <strong className="me-name ellipsis"><UserName p={s.me} /></strong>
          <span className="muted ellipsis">@{s.me.username}</span>
          {isBanned(s.me) && <span className="small danger-text">Banned until {new Date(s.me.banned_until!).toLocaleString()}{s.me.ban_reason ? `: ${s.me.ban_reason}` : ''}</span>}
        </div>
        <button className="btn sm" onClick={() => setEditing(true)}><Pencil size={13} /> Edit profile</button>
      </header>
      <div className="seg friends-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}{t.n ? <span className={'seg-count' + (t.id === 'requests' && s.incoming.length ? ' hot' : '')}>{t.n}</span> : null}
          </button>
        ))}
      </div>
      {s.error && <p className="small danger-text">{s.error}</p>}

      {tab === 'friends' && (s.friends.length
        ? <ul className="people">{s.friends.map((p) => <PersonRow key={p.id} p={p} onOpen={setOpen} status />)}</ul>
        : <p className="muted">No friends yet. Use <button className="link" onClick={() => setTab('find')}>Find people</button> to look someone up by their username.</p>)}

      {tab === 'requests' && (
        <>
          <h4 className="people-head">Asking to be your friend</h4>
          {s.incoming.length ? <ul className="people">{s.incoming.map((p) => (
            <PersonRow key={p.id} p={p} onOpen={setOpen}>
              <button className="btn primary sm" onClick={() => run(() => accept(p.id), `You and ${nameOf(p)} are now friends`)}><Check size={13} /> Accept</button>
              <button className="btn ghost sm" onClick={() => run(() => unfriend(p.id))}>Decline</button>
            </PersonRow>))}</ul> : <p className="muted small">No requests right now.</p>}
          <h4 className="people-head">You asked</h4>
          {s.outgoing.length ? <ul className="people">{s.outgoing.map((p) => (
            <PersonRow key={p.id} p={p} onOpen={setOpen}>
              <span className="muted small">Waiting</span>
              <button className="btn ghost sm" onClick={() => run(() => unfriend(p.id))}>Cancel</button>
            </PersonRow>))}</ul> : <p className="muted small">Nothing waiting.</p>}
        </>
      )}

      {tab === 'find' && <FindPeople onOpen={setOpen} />}

      {tab === 'blocked' && (
        <ul className="people">{s.blocked.map((p) => (
          <PersonRow key={p.id} p={p}>
            <button className="btn ghost sm" onClick={() => run(() => unblock(p.id), `Unblocked ${nameOf(p)}`)}>Unblock</button>
          </PersonRow>))}</ul>
      )}

      {open && <ProfileModal p={open} onClose={() => setOpen(null)} />}
      {editing && <Modal title="Edit profile" onClose={() => setEditing(false)}><div className="pad"><ProfileEditor onDone={() => setEditing(false)} /></div></Modal>}
    </div>
  );
}

function PersonRow({ p, onOpen, status, children }: { p: Profile; onOpen?: (p: Profile) => void; status?: boolean; children?: React.ReactNode }) {
  const s = useSocial(); void s; // re-render when online status refreshes
  const online = status && isOnline(p.id);
  const seen = status ? s.lastSeen[p.id] : undefined;
  return (
    <li className="person">
      <button className="person-main" onClick={() => onOpen?.(p)} disabled={!onOpen}>
        <span className="avatar-wrap"><Avatar name={nameOf(p)} image={p.avatar ?? undefined} size={38} />{status && <span className={'online-dot' + (online ? ' on' : '')} title={online ? 'Online' : 'Offline'} />}</span>
        <span className="col" style={{ minWidth: 0 }}>
          <strong className="ellipsis"><UserName p={p} title={false} /></strong>
          <span className="muted small ellipsis">@{p.username}{status ? (online ? ' · Online' : seen ? ` · seen ${timeAgo(seen)}` : '') : ''}</span>
        </span>
      </button>
      {children && <span className="person-actions">{children}</span>}
    </li>
  );
}

function FindPeople({ onOpen }: { onOpen: (p: Profile) => void }) {
  const s = useSocial();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Profile[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().replace(/^@/, '').length < 2) { setRes(null); return; }
    setBusy(true);
    const t = window.setTimeout(async () => { try { setRes(await searchPeople(q)); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }, 300);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <div className="col gap-s">
      <label className="elist-search find-box"><Search size={14} /><input autoFocus placeholder="Search by username or name, e.g. @mara" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {busy && <p className="muted small">Searching…</p>}
      {res && !res.length && !busy && <p className="muted small">Nobody found. Check the spelling, or ask your friend for their exact username.</p>}
      {res && <ul className="people">{res.map((p) => <PersonRow key={p.id} p={p} onOpen={onOpen}><RelationButton p={p} key={s.friendships.length + p.id} /></PersonRow>)}</ul>}
    </div>
  );
}

/** The right button for where you stand with someone */
function RelationButton({ p }: { p: Profile }) {
  useSocial();
  const r = relationTo(p.id);
  if (r === 'friend') return <span className="muted small">Friends</span>;
  if (r === 'outgoing') return <button className="btn ghost sm" onClick={() => run(() => unfriend(p.id))}>Cancel request</button>;
  if (r === 'incoming') return <button className="btn primary sm" onClick={() => run(() => accept(p.id), `You and ${nameOf(p)} are now friends`)}><Check size={13} /> Accept</button>;
  if (r === 'blocked') return <button className="btn ghost sm" onClick={() => run(() => unblock(p.id))}>Unblock</button>;
  if (r === 'self') return <span className="muted small">You</span>;
  return <button className="btn primary sm" onClick={() => run(() => sendRequest(p.id), 'Friend request sent')}><UserPlus size={13} /> Add friend</button>;
}

export function ProfileModal({ p: initial, onClose }: { p: Profile; onClose: () => void }) {
  useSocial();
  const [p, setP] = useState(initial);
  useEffect(() => { void getProfile(initial.id).then((x) => x && setP(x)); }, [initial.id]);
  const r = relationTo(p.id);
  const since = friendsSince(p.id);
  const online = r === 'friend' && isOnline(p.id);
  return (
    <Modal title={nameOf(p)} onClose={onClose}>
      <div className="pad col gap profile-modal">
        <div className="row gap">
          <span className="avatar-wrap"><Avatar name={nameOf(p)} image={p.avatar ?? undefined} size={84} />{r === 'friend' && <span className={'online-dot big' + (online ? ' on' : '')} />}</span>
          <div className="col" style={{ minWidth: 0 }}>
            <strong className="me-name ellipsis"><UserName p={p} max={0} title={false} /></strong>
            <span className="muted">@{p.username}{p.staff ? ` · ${STAFF_LABEL[p.staff]}` : ''}</span>
            {p.title && <span className="u-title big">{p.title}</span>}
            {isBanned(p) && <span className="small danger-text">Banned until {new Date(p.banned_until!).toLocaleDateString()}</span>}
            {r === 'friend' && <span className="muted small">{online ? 'Online now' : 'Offline'}{since ? ` · friends since ${new Date(since).toLocaleDateString()}` : ''}</span>}
          </div>
        </div>
        {!!p.badges?.length && <div className="badge-list">{p.badges.map(badge).filter(Boolean).map((b) => <span key={b!.id} className="badge-chip">{b!.emoji} {b!.label}</span>)}</div>}
        {p.bio && <p className="profile-bio">{p.bio}</p>}
        <div className="row gap-s wrap">
          {r === 'friend' ? (
            <button className="btn ghost sm" onClick={async () => { if (await confirmDialog(`Remove ${nameOf(p)} from your friends?`, 'You can send a new request later.', { ok: 'Remove friend' })) run(() => unfriend(p.id), 'Removed'); }}><UserMinus size={13} /> Remove friend</button>
          ) : r !== 'self' && <RelationButton p={p} />}
          {r === 'incoming' && <button className="btn ghost sm" onClick={() => run(() => unfriend(p.id))}><X size={13} /> Decline</button>}
          {r !== 'self' && <MuteButton id={p.id} />}
          {r !== 'self' && r !== 'blocked' && (
            <button className="btn ghost sm danger-text" onClick={async () => {
              if (await confirmDialog(`Block ${nameOf(p)}?`, 'They won’t be able to find you or send you requests, and you won’t be friends anymore. They aren’t told.', { danger: true, ok: 'Block' })) { await run(() => block(p.id), `Blocked ${nameOf(p)}`); onClose(); }
            }}><Ban size={13} /> Block</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Pick / change your username, name, picture and bio */
export function ProfileEditor({ first, onDone }: { first?: boolean; onDone: () => void }) {
  const s = useSocial();
  const [username, setUsername] = useState(s.me?.username ?? '');
  const [display, setDisplay] = useState(s.me?.display_name ?? '');
  const [bio, setBio] = useState(s.me?.bio ?? '');
  const [avatar, setAvatar] = useState<string | null>(s.me?.avatar ?? null);
  const [taken, setTaken] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const check = useRef(0);
  const valid = USERNAME_RE.test(username);
  useEffect(() => {
    setTaken(null);
    if (!valid || username === s.me?.username) return;
    const n = ++check.current;
    const t = window.setTimeout(async () => { const v = await usernameTaken(username).catch(() => null); if (n === check.current) setTaken(v); }, 350);
    return () => window.clearTimeout(t);
  }, [username]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setMsg('');
    if (!valid) return setMsg('Usernames are 3–20 characters: lowercase letters, numbers and _.');
    if (taken) return setMsg('That username is taken. Try another.');
    setBusy(true);
    try { await saveProfile({ username, display_name: display, bio, avatar }); toast(first ? 'Profile created' : 'Profile saved'); onDone(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="col gap profile-editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {first && <><h2>Pick a username</h2><p className="muted">Friends find you by your username. You can change your name, picture and username later.</p></>}
      <div className="row gap">
        <ImageBox image={avatar ?? undefined} name={display || username || '?'} round size={84} onChange={async (v) => setAvatar(v === null ? null : v)} />
        <div className="col gap-s grow" style={{ minWidth: 0 }}>
          <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={async () => { const d = await pickImage(256); if (d) setAvatar(d); }}>Choose picture</button>
          {avatar && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAvatar(null)}>Remove picture</button>}
        </div>
      </div>
      <label className="sfield"><span>Username</span>
        <div className="uname-input"><span className="muted">@</span><input className="input" value={username} maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="e.g. mara_writes" /></div>
        <span className={'small ' + (taken ? 'danger-text' : taken === false ? 'acct-ok' : 'muted')}>
          {!username ? '3–20 characters: letters, numbers and _' : !valid ? 'At least 3 characters' : taken ? 'Taken' : taken === false ? 'Available' : ' '}
        </span>
      </label>
      <label className="sfield"><span>Display name</span><input className="input" value={display} maxLength={40} onChange={(e) => setDisplay(e.target.value)} placeholder="What friends see, e.g. Mara Quill" /></label>
      <label className="sfield"><span>About you (optional)</span><textarea className="input" rows={3} maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Fantasy writer, currently drafting book two…" /></label>
      {!first && <label className="check"><input type="checkbox" checked={s.showOnline} onChange={(e) => run(() => setShowOnline(e.target.checked))} /> Let my friends see when I'm online</label>}
      {msg && <p className="small danger-text">{msg}</p>}
      <div className="row gap-s"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : first ? 'Create profile' : 'Save'}</button>{!first && <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>}</div>
    </form>
  );
}
