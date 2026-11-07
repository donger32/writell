/* Admin: overview, people, flagged names, badges, roles & permissions, announcements, fun, names & words, log */
import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Award, Ban, Check, Dice5, Flag, Lock, Unlock, Megaphone, MessageSquareOff, PartyPopper, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Snowflake, Heart,
  Vibrate, Star, Trash2, UserX, Users, X, ScrollText, AtSign, ChevronUp, ChevronDown, Pencil, ScanSearch,
} from 'lucide-react';
import { useSocial } from '../social/api';
import { NAME_COLORS, sillyName, specialNameOk } from '../social/badges';
import { PERMS, OWNER, badgeOf, loadCatalog, rankOf, roleOf, useCatalog, type BadgeDef, type RoleDef } from '../social/catalog';
import * as A from '../social/admin';
import { playLocal } from '../social/effects';
import { currentUserId } from '../sync/engine';
import { Modal, confirmDialog, promptDialog, toast } from './ui';
import { StaffMark, Badges } from './UserName';
import { Avatar } from './story/common';
import { timeAgo } from '../util';

type Tab = 'overview' | 'people' | 'flags' | 'badges' | 'roles' | 'announce' | 'fun' | 'names' | 'log';
const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok); return true; } catch (e) { toast((e as Error).message); return false; } };
const fx = (kind: A.FxKind, target: string | null = null, text: string | null = null) => {
  const me = currentUserId()!;
  return run(async () => { await A.sendFx(kind, target, text); if (!target || target === me) playLocal({ id: 0, kind, target, text, created_by: me, created_at: new Date().toISOString() }); });
};
const TITLES = ['Supreme Wordlord', 'Comma Criminal', 'Plot Hole Inspector', 'Keeper of Lore', 'Professional Procrastinator', 'Chief Villain Officer', 'Typo Goblin', 'Cliffhanger Enjoyer'];
const SWATCHES = ['#e8b14a', '#e0455f', '#f472b6', '#a66cff', '#5fa8f5', '#2fbf8f', '#8bc34a', '#ff8a3d', '#8b8d98'];
/** What the signed-in staff member is allowed to do */
function usePerms() {
  const social = useSocial(); useCatalog();
  const role = roleOf(social.me?.staff);
  return { role, rank: rankOf(social.me?.staff), owner: social.me?.staff === 'owner', has: (p: string) => !!role?.perms.includes(p) };
}

export function AdminView() {
  const social = useSocial();
  const P = usePerms();
  const [tab, setTab] = useState<Tab>('overview');
  const [flagCount, setFlagCount] = useState(0);
  useEffect(() => { void loadCatalog(); }, []);
  useEffect(() => { if (P.has('flags')) void A.flags().then((f) => setFlagCount(f.length)).catch(() => {}); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!social.ready) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!P.rank) return <div className="page"><h1>Admin</h1><p className="muted">Only Writell staff can open this page.</p></div>;
  const TABS: [Tab, string, typeof Users, boolean][] = [
    ['overview', 'Overview', Activity, true], ['people', 'People', Users, true], ['flags', 'Flags', Flag, P.has('flags')],
    ['badges', 'Badges', Award, P.has('manage_badges')], ['roles', 'Roles', ShieldCheck, P.owner], ['announce', 'Announce', Megaphone, P.has('announce')],
    ['fun', 'Fun', Sparkles, P.has('effects')], ['names', 'Names & words', AtSign, P.has('reserve_names') || P.has('filter_words')], ['log', 'Log', ScrollText, P.has('view_log')],
  ];
  return (
    <div className="page admin-page">
      <header className="admin-head">
        <span className="admin-crest" style={{ borderColor: P.role?.color }}><StaffMark staff={social.me!.staff} size={22} /></span>
        <div className="col">
          <h1>Admin</h1>
          <span className="muted small">{P.owner ? 'You’re the Writell owner: you can do everything.' : `Your role: ${P.role?.name ?? 'staff'}.`} Writing and chats stay encrypted: staff can’t read them.</span>
        </div>
      </header>
      <div className="admin-tabs" role="tablist">
        {TABS.filter((t) => t[3]).map(([t, l, I]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}><I size={15} /> {l}{t === 'flags' && flagCount > 0 && <span className="seg-count hot">{flagCount}</span>}</button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab onTab={setTab} />}
      {tab === 'people' && <PeopleTab />}
      {tab === 'flags' && <FlagsTab onChange={setFlagCount} />}
      {tab === 'badges' && <BadgesTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'announce' && <AnnounceTab />}
      {tab === 'fun' && <FunTab />}
      {tab === 'names' && <NamesTab />}
      {tab === 'log' && <LogTab />}
    </div>
  );
}

/* ---------------- overview ---------------- */
function OverviewTab({ onTab }: { onTab: (t: Tab) => void }) {
  const P = usePerms();
  const [o, setO] = useState<A.Overview | null>(null);
  const [error, setError] = useState('');
  const load = () => A.overview().then(setO).catch((e) => setError(e.message));
  useEffect(() => { void load(); const t = window.setInterval(load, 30_000); return () => window.clearInterval(t); }, []);
  if (error) return <p className="danger-text small">{error}</p>;
  if (!o) return <p className="muted">Loading…</p>;
  const tiles: [string, number, string?][] = [
    ['Online now', o.online, 'live'], ['Active this week', o.active_week], ['Accounts', o.accounts], ['With a profile', o.profiles],
    ['New this week', o.new_week], ['Friendships', o.friendships], ['Shared projects', o.shared_projects], ['Chat messages today', o.messages_today],
    ['Chat messages', o.messages], ['Staff', o.staff], ['Banned now', o.banned, o.banned ? 'warn' : undefined],
    ...(o.open_flags !== undefined ? [['Flagged names', o.open_flags, o.open_flags ? 'warn' : undefined] as [string, number, string?]] : []),
  ];
  return (
    <>
      <div className="stat-tiles">
        {tiles.map(([l, n, k]) => <div key={l} className={'stat-tile' + (k ? ' ' + k : '')}><span className="stat-n">{n.toLocaleString()}</span><span className="stat-l">{l}</span></div>)}
      </div>
      <div className="row gap-s wrap">
        <button className="btn sm" onClick={() => onTab('people')}><Users size={13} /> See everyone</button>
        {P.has('flags') && !!o.open_flags && <button className="btn sm" onClick={() => onTab('flags')}><Flag size={13} /> Review flagged names</button>}
        <button className="btn ghost sm" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button>
      </div>
    </>
  );
}

/* ---------------- people ---------------- */
const online = (p: A.Person) => !!p.last_seen && Date.now() - Date.parse(p.last_seen) < 180_000;
function PersonRow({ p, onOpen, extra }: { p: A.Person; onOpen: () => void; extra?: React.ReactNode }) {
  const until = (d?: string | null) => !!d && Date.parse(d) > Date.now();
  return (
    <li className="person">
      <button className="person-main" onClick={onOpen}>
        <span className="avatar-wrap"><Avatar name={p.display_name || p.username} size={36} /><span className={'online-dot' + (online(p) ? ' on' : '')} /></span>
        <span className="col" style={{ minWidth: 0 }}>
          <strong className="ellipsis"><span className={'uname-text' + (p.name_color ? ' nc-' + p.name_color : '')}>{p.display_name || p.username}</span> <StaffMark staff={p.staff} /> <Badges ids={p.badges} max={4} /></strong>
          <span className="muted small ellipsis">@{p.username}{p.title ? ` · ${p.title}` : ''} · {online(p) ? 'online now' : p.last_seen ? `seen ${timeAgo(Date.parse(p.last_seen))}` : 'never seen'}</span>
        </span>
      </button>
      <span className="person-actions">
        {extra}
        {!!p.open_flags && <span className="role-pill danger" title="Flagged name"><Flag size={11} /> {p.open_flags}</span>}
        {until(p.banned_until) && <span className="role-pill danger">Banned</span>}
        {until(p.chat_muted_until) && <span className="role-pill danger">Chat muted</span>}
        {p.name_locked && <span className="role-pill" title="Name locked"><Lock size={11} /></span>}
      </span>
    </li>
  );
}
function PeopleTab() {
  const [q, setQ] = useState('');
  const [list, setList] = useState<A.Person[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = (query = q) => A.people(query).then((l) => { setList(l); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { const t = window.setTimeout(() => void load(q), 250); return () => window.clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const person = list?.find((p) => p.id === open);
  return (
    <>
      <div className="search-box admin-search"><Search size={15} /><input className="input" placeholder="Search by username or name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {error && <p className="danger-text small">{error}</p>}
      {!list ? <p className="muted">Loading…</p> : !list.length ? <p className="muted">Nobody found.</p> : (
        <ul className="people admin-people">{list.map((p) => <PersonRow key={p.id} p={p} onOpen={() => setOpen(p.id)} />)}</ul>
      )}
      {person && <PersonEditor p={person} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </>
  );
}

const TIMES: [string, number | null][] = [['10 minutes', 10 / 60], ['1 hour', 1], ['1 day', 24], ['1 week', 168], ['Forever', null]];
const untilFrom = (h: number) => (h < 0 ? '9999-12-31T00:00:00Z' : new Date(Date.now() + h * 3600_000).toISOString());
function TimeSelect({ value, onChange, label }: { value: number; onChange: (h: number) => void; label: string }) {
  return <select className="pill-select" value={value < 0 ? 'null' : String(value)} onChange={(e) => onChange(e.target.value === 'null' ? -1 : Number(e.target.value))} aria-label={label}>{TIMES.map(([l, h]) => <option key={l} value={h === null ? 'null' : String(h)}>{l}</option>)}</select>;
}

function PersonEditor({ p, onClose, onChanged }: { p: A.Person; onClose: () => void; onChanged: () => void }) {
  const P = usePerms();
  const cat = useCatalog();
  const self = p.id === currentUserId();
  const canTouch = self || rankOf(p.staff) < P.rank;
  const [username, setUsername] = useState(p.username);
  const [display, setDisplay] = useState(p.display_name);
  const [title, setTitle] = useState(p.title ?? '');
  const [banFor, setBanFor] = useState(1);
  const [muteFor, setMuteFor] = useState(1);
  const [reason, setReason] = useState('');
  useEffect(() => { setUsername(p.username); setDisplay(p.display_name); setTitle(p.title ?? ''); }, [p.username, p.display_name, p.title]);
  const name = p.display_name || p.username;
  const change = async (c: A.Changes, ok: string) => { if (await run(() => A.update(p.id, c), ok)) onChanged(); };
  const until = (d?: string | null) => !!d && Date.parse(d) > Date.now();
  const toggleBadge = (b: BadgeDef) => change({ badges: p.badges.includes(b.id) ? p.badges.filter((x) => x !== b.id) : [...p.badges, b.id] }, p.badges.includes(b.id) ? `Took away “${b.label}”` : `Gave ${name} “${b.label}” ${b.emoji}`);
  const unameOk = specialNameOk(username);
  const role = roleOf(p.staff);
  const sections = ['rename', 'lock_names', 'titles_colors', 'give_badges', 'ban', 'moderate_chats', 'clear_profiles', 'effects'].some(P.has) || P.owner;
  return (
    <Modal title={`@${p.username}`} onClose={onClose}>
      <div className="pad col gap admin-editor">
        <div className="row gap">
          <Avatar name={name} size={56} />
          <div className="col grow" style={{ minWidth: 0 }}>
            <strong className="me-name ellipsis"><span className={'uname-text' + (p.name_color ? ' nc-' + p.name_color : '')}>{name}</span> <StaffMark staff={p.staff} /> <Badges ids={p.badges} max={6} /></strong>
            <span className="muted small">{role ? <b style={{ color: role.color }}>{role.name}</b> : 'Member'} · joined {new Date(p.created_at).toLocaleDateString()} · {p.friends} friends · in {p.projects} shared projects{p.last_seen ? ` · seen ${timeAgo(Date.parse(p.last_seen))}` : ''}</span>
            {p.title && <span className="u-title big">{p.title}</span>}
          </div>
        </div>
        {!canTouch && <p className="small danger-text">{name} has the same rank as you or higher, so you can’t change them.</p>}
        {!sections && <p className="muted small">Your role can’t change people. Ask the owner for more permissions.</p>}
        <fieldset disabled={!canTouch} className="col gap admin-fields">
          {(P.has('rename') || P.has('lock_names')) && (
            <section>
              <h4>Name</h4>
              {P.has('rename') && <>
                <div className="row gap-s wrap">
                  <label className="field grow"><span>Username</span><input className="input mono" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} spellCheck={false} autoCapitalize="none" /></label>
                  <label className="field grow"><span>Display name</span><input className="input" value={display} maxLength={40} onChange={(e) => setDisplay(e.target.value)} /></label>
                </div>
                {!unameOk ? <span className="small danger-text">1–24 characters, no spaces</span>
                  : <span className="muted small">Staff can give special usernames: one letter, capitals, symbols or emoji (★, ✨, 🐐…). Staff names skip the word filter.</span>}
              </>}
              <div className="row gap-s wrap">
                {P.has('rename') && <>
                  <button className="btn primary sm" disabled={!unameOk || (username === p.username && display === p.display_name)} onClick={() => change({ ...(username !== p.username ? { username } : {}), ...(display !== p.display_name ? { display_name: display } : {}) }, 'Name changed')}>Save name</button>
                  <button className="btn sm" onClick={() => { const n = sillyName(); change({ username: n, display_name: n.replace(/_/g, ' ').replace(/\d+$/, '').replace(/\b\w/g, (c) => c.toUpperCase()).trim() }, `${name} is now @${n} 🎲`); }}><Dice5 size={13} /> Surprise rename</button>
                </>}
                {P.has('lock_names') && <button className="btn ghost sm" onClick={() => change({ name_locked: !p.name_locked }, p.name_locked ? 'Name unlocked' : `Locked: ${name} can’t change their name`)}>{p.name_locked ? <><Unlock size={13} /> Unlock name</> : <><Lock size={13} /> Lock name</>}</button>}
              </div>
            </section>
          )}
          {P.has('titles_colors') && (
            <section>
              <h4>Title & name color</h4>
              <div className="row gap-s"><input className="input grow" value={title} maxLength={40} placeholder="Title shown under their name" onChange={(e) => setTitle(e.target.value)} /><button className="btn sm" disabled={title === (p.title ?? '')} onClick={() => change({ title: title.trim() || null }, title.trim() ? 'Title given' : 'Title removed')}>Save</button></div>
              <div className="chips">{TITLES.map((t) => <button key={t} className="count-chip" onClick={() => setTitle(t)}>{t}</button>)}</div>
              <div className="swatches">
                <button className={'swatch none' + (!p.name_color ? ' on' : '')} title="No color" onClick={() => change({ name_color: null }, 'Color removed')}><X size={12} /></button>
                {NAME_COLORS.map((c) => <button key={c.id} className={'swatch' + (p.name_color === c.id ? ' on' : '')} title={c.label} style={{ background: c.swatch }} onClick={() => change({ name_color: c.id }, `${name}’s name is now ${c.label.toLowerCase()}`)} />)}
              </div>
            </section>
          )}
          {P.has('give_badges') && (
            <section>
              <h4>Badges</h4>
              {!cat.badges.length ? <p className="muted small">No badges yet. {P.has('manage_badges') ? 'Make some in the Badges tab.' : 'Someone with “Make badges” can create them.'}</p> : (
                <div className="badge-grid">{cat.badges.map((b) => <button key={b.id} className={'badge-toggle' + (p.badges.includes(b.id) ? ' on' : '')} style={p.badges.includes(b.id) && b.color ? { borderColor: b.color } : undefined} onClick={() => toggleBadge(b)} aria-pressed={p.badges.includes(b.id)} title={b.description ?? undefined}><span>{b.emoji}</span>{b.label}</button>)}</div>
              )}
            </section>
          )}
          {P.owner && !self && (
            <section>
              <h4>Role</h4>
              <div className="role-pick">
                <button className={!p.staff ? 'on' : ''} onClick={() => run(() => A.setStaff(p.id, null), 'Role removed').then((ok) => ok && onChanged())}>Member</button>
                {cat.roles.map((r) => <button key={r.id} className={p.staff === r.id ? 'on' : ''} style={{ '--rc': r.color } as React.CSSProperties} onClick={() => run(() => A.setStaff(p.id, r.id), `${name} is now ${r.name}`).then((ok) => ok && onChanged())}><ShieldCheck size={13} /> {r.name}</button>)}
              </div>
              <p className="muted small">Make roles and choose what each one can do in the Roles tab.</p>
            </section>
          )}
          {P.has('effects') && !self && (
            <section>
              <h4>Fun</h4>
              <div className="row gap-s wrap">
                <button className="btn sm" onClick={() => fx('confetti', p.id).then((ok) => ok && toast(`Confetti sent to ${name} 🎉`))}><PartyPopper size={13} /> Confetti</button>
                <button className="btn sm" onClick={() => fx('hearts', p.id).then((ok) => ok && toast('Hearts sent 💖'))}><Heart size={13} /> Hearts</button>
                <button className="btn sm" onClick={() => fx('shake', p.id).then((ok) => ok && toast(`${name}’s screen wobbles`))}><Vibrate size={13} /> Shake</button>
                <button className="btn sm" onClick={async () => { const t = await promptDialog(`Shout at ${name}`, '', 'Send'); if (t?.trim()) void fx('shout', p.id, t.trim().slice(0, 200)).then((ok) => ok && toast('Shout sent 📣')); }}><Megaphone size={13} /> Shout</button>
                <button className="btn sm" onClick={() => fx('spotlight', null, p.id).then((ok) => ok && toast(`Everyone sees ${name} in the spotlight 🌟`))}><Star size={13} /> Spotlight for everyone</button>
              </div>
            </section>
          )}
          {P.has('moderate_chats') && !self && (
            <section>
              <h4>Chats</h4>
              {until(p.chat_muted_until) ? (
                <div className="row gap-s wrap"><span className="small danger-text grow">Muted in chats until {new Date(p.chat_muted_until!).toLocaleString()}</span>
                  <button className="btn sm" onClick={() => change({ chat_muted_until: null }, `${name} can chat again`)}>Unmute</button></div>
              ) : (
                <div className="row gap-s wrap">
                  <TimeSelect value={muteFor} onChange={setMuteFor} label="Mute for" />
                  <button className="btn sm" onClick={() => change({ chat_muted_until: untilFrom(muteFor) }, `${name} is muted in chats`)}><MessageSquareOff size={13} /> Mute in all chats</button>
                </div>
              )}
              <div className="row gap-s wrap">
                <button className="btn ghost sm" onClick={async () => {
                  if (!(await confirmDialog(`Remove everything ${name} wrote in chats?`, 'Their messages and comments disappear from every shared project. This can’t be undone.', { danger: true, ok: 'Remove all' }))) return;
                  void run(async () => { const n = await A.wipeMessages(p.id); toast(n ? `Removed ${n} message${n === 1 ? '' : 's'}` : 'They had no messages'); });
                }}><Trash2 size={13} /> Remove all their chat messages</button>
              </div>
              <p className="muted small">Messages stay encrypted: you can remove them without reading them.</p>
            </section>
          )}
          {(P.has('ban') || P.has('clear_profiles')) && !self && (
            <section>
              <h4>Moderation</h4>
              {P.has('ban') && (until(p.banned_until) ? (
                <div className="row gap-s wrap"><span className="small danger-text grow">Banned until {new Date(p.banned_until!).toLocaleString()}{p.ban_reason ? `: ${p.ban_reason}` : ''}</span>
                  <button className="btn sm" onClick={() => change({ banned_until: null, ban_reason: null }, `${name} is unbanned`)}>Unban</button></div>
              ) : (
                <div className="row gap-s wrap">
                  <TimeSelect value={banFor} onChange={setBanFor} label="Ban for" />
                  <input className="input sm grow" placeholder="Reason (they see it)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
                  <button className="btn sm danger" onClick={async () => {
                    if (!(await confirmDialog(`Ban ${name}?`, 'They can’t chat or send friend requests until it ends. Their own writing and sync keep working.', { danger: true, ok: 'Ban' }))) return;
                    void change({ banned_until: untilFrom(banFor), ban_reason: reason.trim() || null }, `${name} is banned`);
                  }}><Ban size={13} /> Ban</button>
                </div>
              ))}
              {P.has('clear_profiles') && (
                <div className="row gap-s wrap">
                  {p.bio && <button className="btn ghost sm" onClick={() => change({ bio: '' }, 'Bio cleared')}><X size={13} /> Clear bio</button>}
                  {p.has_avatar && <button className="btn ghost sm" onClick={() => change({ avatar: null }, 'Picture removed')}><UserX size={13} /> Remove picture</button>}
                  {!p.bio && !p.has_avatar && <span className="muted small">No bio or picture to clear.</span>}
                </div>
              )}
            </section>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}

/* ---------------- flagged names ---------------- */
function FlagsTab({ onChange }: { onChange: (n: number) => void }) {
  const P = usePerms();
  const [all, setAll] = useState(false);
  const [list, setList] = useState<A.Flag[] | null>(null);
  const [people, setPeople] = useState<Map<string, A.Person>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const load = async () => {
    try {
      const [f, ps] = await Promise.all([A.flags(all), A.people('')]);
      setList(f); setPeople(new Map(ps.map((x) => [x.id, x])));
      if (!all) onChange(f.length);
    } catch (e) { toast((e as Error).message); setList([]); }
  };
  useEffect(() => { void load(); }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const person = open ? people.get(open) : undefined;
  return (
    <div className="col gap">
      <p className="muted small">Names the word filter let through but that might be bad: they contain a “flag” word, or are one letter away from a blocked word. Only staff see this. Names with blocked words can’t be picked at all.</p>
      <div className="row gap-s wrap">
        <label className="check small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show handled ones</label>
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => run(async () => { const n = await A.scanNames(); toast(n ? `${n} new flag${n === 1 ? '' : 's'}` : 'Everyone’s names look fine'); await load(); })}><ScanSearch size={13} /> Check everyone’s names again</button>
      </div>
      {!list ? <p className="muted">Loading…</p> : !list.length ? <div className="chat-empty"><Check size={28} /><p>{all ? 'Nothing flagged yet.' : 'No flagged names right now.'}</p></div> : (
        <ul className="flag-list">{list.map((f) => {
          const p = people.get(f.user_id);
          return (
            <li key={f.id} className={'flag-item ' + f.status}>
              <div className="col grow" style={{ minWidth: 0 }}>
                <span><b className="mono">{f.name}</b> <span className="muted small">({f.field === 'username' ? 'username' : 'display name'})</span></span>
                <span className="small muted">{f.how === 'close' ? <>looks close to <b className="danger-text">{f.word}</b></> : <>contains <b className="danger-text">{f.word}</b></>} · {p ? <>@{p.username}{(p.username !== f.name && p.display_name !== f.name) ? ' (already changed)' : ''}</> : 'someone'} · {timeAgo(Date.parse(f.created_at))}{f.status !== 'open' ? ` · ${f.status === 'ok' ? 'marked fine' : 'renamed'}` : ''}</span>
              </div>
              {f.status === 'open' ? <>
                <button className="btn ghost sm" onClick={() => run(() => A.setFlag(f.id, 'ok'), 'Marked as fine').then(() => load())}><Check size={13} /> Looks fine</button>
                {p && <button className="btn sm" onClick={() => setOpen(p.id)}><Pencil size={13} /> {P.has('rename') ? 'Rename / ban' : 'Open'}</button>}
              </> : <button className="btn ghost sm" onClick={() => run(() => A.setFlag(f.id, 'open')).then(() => load())}>Reopen</button>}
            </li>
          );
        })}</ul>
      )}
      {person && <PersonEditor p={person} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </div>
  );
}

/* ---------------- custom badges ---------------- */
function BadgesTab() {
  const cat = useCatalog();
  const blank = { id: '', emoji: '', label: '', color: '', description: '' };
  const [form, setForm] = useState(blank);
  const ok = form.emoji.trim() && form.label.trim();
  const save = () => run(() => A.saveBadge({ ...form, id: form.id || undefined, emoji: form.emoji.trim(), label: form.label.trim() }), form.id ? 'Badge saved' : `Badge “${form.label.trim()}” made`).then((r) => r && setForm(blank));
  return (
    <div className="col gap">
      <p className="muted small">Make your own badges and give them out under People. Deleting a badge takes it away from everyone who has it.</p>
      <div className="badge-maker">
        <div className="badge-preview" style={form.color ? { borderColor: form.color, color: form.color } : undefined}><span>{form.emoji || '✨'}</span>{form.label || 'Badge name'}</div>
        <div className="row gap-s wrap">
          <input className="input emoji-input" value={form.emoji} maxLength={8} placeholder="🏅" aria-label="Emoji" onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
          <input className="input grow" value={form.label} maxLength={40} placeholder="Name, e.g. Plot Wizard" onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </div>
        <input className="input" value={form.description} maxLength={120} placeholder="What it’s for (optional, shows on hover)" onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="swatches">
          <button className={'swatch none' + (!form.color ? ' on' : '')} title="No color" onClick={() => setForm({ ...form, color: '' })}><X size={12} /></button>
          {SWATCHES.map((c) => <button key={c} className={'swatch' + (form.color === c ? ' on' : '')} style={{ background: c }} title={c} onClick={() => setForm({ ...form, color: c })} />)}
          <input type="color" className="color-pick" value={form.color || '#8b7cf6'} onChange={(e) => setForm({ ...form, color: e.target.value })} aria-label="Custom color" />
        </div>
        <div className="row gap-s">
          <button className="btn primary sm" disabled={!ok} onClick={() => void save()}>{form.id ? <><Check size={13} /> Save badge</> : <><Plus size={13} /> Make badge</>}</button>
          {form.id && <button className="btn ghost sm" onClick={() => setForm(blank)}>Cancel</button>}
        </div>
      </div>
      <h4>Your badges</h4>
      {!cat.badges.length ? <p className="muted small">None yet.</p> : (
        <ul className="badge-admin-list">{cat.badges.map((b) => (
          <li key={b.id}>
            <span className="badge-chip" style={b.color ? { borderColor: b.color, color: b.color } : undefined}>{b.emoji} {b.label}</span>
            <span className="muted small grow ellipsis">{b.description}</span>
            <button className="icon-btn sm" aria-label={`Edit ${b.label}`} onClick={() => setForm({ id: b.id, emoji: b.emoji, label: b.label, color: b.color ?? '', description: b.description ?? '' })}><Pencil size={13} /></button>
            <button className="icon-btn sm" aria-label={`Delete ${b.label}`} onClick={async () => { if (await confirmDialog(`Delete “${b.label}”?`, 'Everyone who has it loses it.', { danger: true, ok: 'Delete' })) void run(() => A.deleteBadge(b.id), 'Badge deleted'); }}><Trash2 size={13} /></button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

/* ---------------- roles & permissions (owner) ---------------- */
function RolesTab() {
  const cat = useCatalog();
  const [edit, setEdit] = useState<RoleDef | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => { void A.people('').then((l) => { const c: Record<string, number> = {}; for (const p of l) if (p.staff) c[p.staff] = (c[p.staff] ?? 0) + 1; setCounts(c); }).catch(() => {}); }, [cat.roles.length]);
  const roles = cat.roles;
  const move = (i: number, d: -1 | 1) => {
    const a = roles[i], b = roles[i + d]; if (!a || !b) return;
    // swap ranks (keep them different)
    const ra = b.rank, rb = a.rank === b.rank ? a.rank + (d === -1 ? 1 : -1) : a.rank;
    void run(async () => { await A.saveRole({ ...a, rank: ra }); await A.saveRole({ ...b, rank: Math.max(1, rb) }); });
  };
  const create = async () => {
    const n = (await promptDialog('Name of the new role', '', 'Make role'))?.trim(); if (!n) return;
    const id = (n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'role').slice(0, 20) + '-' + Math.random().toString(36).slice(2, 6);
    const low = roles.length ? Math.min(...roles.map((r) => r.rank)) : 100;
    const r: RoleDef = { id, name: n.slice(0, 30), color: SWATCHES[roles.length % SWATCHES.length], rank: Math.max(1, low - 10), perms: [] };
    if (await run(() => A.saveRole(r), `Role “${r.name}” made: now pick what it can do`)) setEdit(r);
  };
  return (
    <div className="col gap">
      <p className="muted small">Roles are listed from most to least powerful. Someone can only change people below their own role. You (the owner) are above every role and the only one who can give roles out (under People).</p>
      <ul className="role-list">
        <li className="role-row owner"><span className="role-name" style={{ color: OWNER.color }}><StaffMark staff="owner" /> Owner</span><span className="muted small grow">Everything</span></li>
        {roles.map((r, i) => (
          <li key={r.id} className="role-row">
            <span className="role-name" style={{ color: r.color }}><ShieldCheck size={14} /> {r.name}</span>
            <span className="muted small grow ellipsis">{r.perms.length ? r.perms.map((p) => PERMS.find((x) => x.id === p)?.label ?? p).join(', ') : 'No permissions yet'}</span>
            <span className="muted small">{counts[r.id] ?? 0} {counts[r.id] === 1 ? 'person' : 'people'}</span>
            <button className="icon-btn sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp size={14} /></button>
            <button className="icon-btn sm" aria-label="Move down" disabled={i === roles.length - 1} onClick={() => move(i, 1)}><ChevronDown size={14} /></button>
            <button className="btn sm" onClick={() => setEdit(r)}><Pencil size={13} /> Edit</button>
          </li>
        ))}
      </ul>
      <div><button className="btn primary sm" onClick={() => void create()}><Plus size={13} /> New role</button></div>
      {edit && <RoleEditor role={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
function RoleEditor({ role, onClose }: { role: RoleDef; onClose: () => void }) {
  const [r, setR] = useState(role);
  const toggle = (p: string) => setR({ ...r, perms: r.perms.includes(p) ? r.perms.filter((x) => x !== p) : [...r.perms, p] });
  return (
    <Modal title={`Role: ${role.name}`} onClose={onClose}>
      <div className="pad col gap admin-editor">
        <div className="row gap-s wrap">
          <label className="field grow"><span>Name</span><input className="input" value={r.name} maxLength={30} onChange={(e) => setR({ ...r, name: e.target.value })} /></label>
        </div>
        <div className="swatches">
          {SWATCHES.map((c) => <button key={c} className={'swatch' + (r.color === c ? ' on' : '')} style={{ background: c }} title={c} onClick={() => setR({ ...r, color: c })} />)}
          <input type="color" className="color-pick" value={r.color} onChange={(e) => setR({ ...r, color: e.target.value })} aria-label="Custom color" />
          <span className="role-name" style={{ color: r.color, marginLeft: 8 }}><ShieldCheck size={14} /> {r.name || 'Role'}</span>
        </div>
        <h4 className="perm-head">What this role can do</h4>
        <div className="perm-grid">
          {PERMS.map((p) => (
            <label key={p.id} className={'perm' + (r.perms.includes(p.id) ? ' on' : '')}>
              <input type="checkbox" checked={r.perms.includes(p.id)} onChange={() => toggle(p.id)} />
              <span className="col"><b>{p.label}</b><span className="muted small">{p.hint}</span></span>
            </label>
          ))}
        </div>
        <div className="row gap-s">
          <button className="btn ghost sm" onClick={() => setR({ ...r, perms: PERMS.map((p) => p.id) })}>Allow everything</button>
          <button className="btn ghost sm" onClick={() => setR({ ...r, perms: [] })}>Allow nothing</button>
          <span className="grow" />
          <button className="btn ghost sm danger-text" onClick={async () => { if (await confirmDialog(`Delete the role “${role.name}”?`, 'Everyone with it goes back to being a normal member.', { danger: true, ok: 'Delete role' })) { if (await run(() => A.deleteRole(role.id), 'Role deleted')) onClose(); } }}><Trash2 size={13} /> Delete role</button>
          <button className="btn primary sm" disabled={!r.name.trim()} onClick={async () => { if (await run(() => A.saveRole({ ...r, name: r.name.trim() }), 'Role saved')) onClose(); }}><Check size={13} /> Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- announcements ---------------- */
function AnnounceTab() {
  const [text, setText] = useState('');
  const [style, setStyle] = useState<A.AnnStyle>('info');
  const [hours, setHours] = useState<number | null>(24);
  const [list, setList] = useState<A.Announcement[]>([]);
  const load = () => A.allAnnouncements().then(setList).catch((e) => toast(e.message));
  useEffect(() => { void load(); }, []);
  const STYLES: [A.AnnStyle, string][] = [['info', '📢 Info'], ['party', '🎉 Party'], ['warning', '⚠️ Warning'], ['love', '💖 Love']];
  const live = (a: A.Announcement) => !a.expires_at || Date.parse(a.expires_at) > Date.now();
  return (
    <div className="col gap">
      <p className="muted small">A banner at the top of Writell for everyone who’s signed in. Party announcements throw confetti when people first see them.</p>
      <div className={'ann-bar preview ' + style}><Megaphone size={15} /><span className="grow">{text || 'Your announcement appears like this'}</span></div>
      <textarea className="input" rows={2} maxLength={500} value={text} placeholder="What do you want to tell everyone?" onChange={(e) => setText(e.target.value)} />
      <div className="row gap-s wrap">
        <div className="seg">{STYLES.map(([s, l]) => <button key={s} className={style === s ? 'on' : ''} onClick={() => setStyle(s)}>{l}</button>)}</div>
        <select className="pill-select" value={String(hours)} onChange={(e) => setHours(e.target.value === 'null' ? null : Number(e.target.value))} aria-label="How long">
          <option value="1">For 1 hour</option><option value="24">For 1 day</option><option value="168">For 1 week</option><option value="null">Until I remove it</option>
        </select>
        <button className="btn primary" disabled={!text.trim()} onClick={() => run(() => A.announce(text.trim(), style, hours), 'Announced').then((ok) => { if (ok) { setText(''); void load(); } })}><Megaphone size={14} /> Post</button>
      </div>
      <h4>Announcements</h4>
      {!list.length ? <p className="muted small">None yet.</p> : (
        <ul className="ann-list">{list.map((a) => (
          <li key={a.id} className={'ann-item ' + a.style + (live(a) ? '' : ' ended')}>
            <span className="grow">{a.text}<span className="muted small"> · {timeAgo(Date.parse(a.created_at))}{live(a) ? (a.expires_at ? ` · ends ${new Date(a.expires_at).toLocaleString()}` : ' · until removed') : ' · ended'}</span></span>
            {live(a) && <button className="btn ghost sm" onClick={() => run(() => A.endAnnouncement(a.id), 'Removed').then(() => load())}><Trash2 size={13} /> Remove</button>}
          </li>))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- fun ---------------- */
function FunTab() {
  const [shout, setShout] = useState('');
  const [who, setWho] = useState<A.Person[]>([]);
  const [spot, setSpot] = useState('');
  useEffect(() => { void A.people('').then(setWho).catch(() => {}); }, []);
  const onlineN = useMemo(() => who.filter(online).length, [who]);
  const B = ({ k, icon, label, hint }: { k: A.FxKind; icon: React.ReactNode; label: string; hint: string }) => (
    <button className="fun-card" onClick={() => fx(k).then((ok) => ok && toast(`${label} for everyone!`))}><span className="fun-icon">{icon}</span><strong>{label}</strong><span className="muted small">{hint}</span></button>
  );
  return (
    <div className="col gap">
      <p className="muted small">These pop up on the screen of everyone who has Writell open right now{onlineN ? ` (about ${onlineN})` : ''}. Want to hit just one person? Open them under People.</p>
      <div className="fun-grid">
        <B k="confetti" icon={<PartyPopper size={22} />} label="Confetti" hint="A burst from both sides" />
        <B k="snow" icon={<Snowflake size={22} />} label="Snow" hint="Seven seconds of snowfall" />
        <B k="hearts" icon={<Heart size={22} />} label="Hearts" hint="Floating hearts" />
        <B k="shake" icon={<Vibrate size={22} />} label="Earthquake" hint="Everyone’s screen wobbles" />
      </div>
      <h4>Shout</h4>
      <div className="row gap-s"><input className="input grow" value={shout} maxLength={200} placeholder="A big message in the middle of everyone’s screen" onChange={(e) => setShout(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && shout.trim()) void fx('shout', null, shout.trim()).then((ok) => ok && setShout('')); }} />
        <button className="btn primary" disabled={!shout.trim()} onClick={() => fx('shout', null, shout.trim()).then((ok) => ok && setShout(''))}><Megaphone size={14} /> Shout</button></div>
      <h4>Spotlight</h4>
      <div className="row gap-s">
        <select className="pill-select grow" value={spot} onChange={(e) => setSpot(e.target.value)} aria-label="Who to spotlight"><option value="">Pick someone…</option>{who.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.username} (@{p.username})</option>)}</select>
        <button className="btn" disabled={!spot} onClick={() => fx('spotlight', null, spot)}><Star size={14} /> Spotlight</button>
      </div>
      <p className="muted small">Shows their card with confetti on everyone’s screen.</p>
    </div>
  );
}

/* ---------------- reserved names & word filter ---------------- */
function NamesTab() {
  const P = usePerms();
  return (
    <div className="col gap">
      {P.has('filter_words') && <WordFilter />}
      {P.has('reserve_names') && <Reserved />}
    </div>
  );
}
function WordFilter() {
  const [list, setList] = useState<A.Word[] | null>(null);
  const [word, setWord] = useState('');
  const [level, setLevel] = useState<A.WordLevel>('block');
  const [test, setTest] = useState('');
  const [result, setResult] = useState<A.Check[] | null>(null);
  const load = () => A.words().then(setList).catch((e) => { toast(e.message); setList([]); });
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!test.trim()) { setResult(null); return; } const t = window.setTimeout(() => void A.checkName(test).then(setResult).catch(() => setResult(null)), 300); return () => window.clearTimeout(t); }, [test, list]);
  const GROUPS: [A.WordLevel, string, string][] = [
    ['block', 'Blocked', 'Nobody can pick a name containing these (also with tricks like f.u.c.k, h1tl3r or fuuuck).'],
    ['flag', 'Flagged', 'Allowed, but the name shows up in Flags for staff to look at.'],
    ['allow', 'Allowed words', 'Innocent words that contain a bad one (Scunthorpe, cocktail, assassin): ignored when checking.'],
  ];
  const blocked = result?.some((r) => r.level === 'block' && r.how === 'contains');
  return (
    <section className="col gap-s">
      <h3 className="sec-title">Name filter</h3>
      <div className="name-test">
        <input className="input grow" value={test} placeholder="Test a name…" onChange={(e) => setTest(e.target.value)} />
        {result && <span className={'small ' + (blocked ? 'danger-text' : result.length ? 'warn-text' : 'acct-ok')}>
          {blocked ? `Blocked: contains “${result.find((r) => r.level === 'block')!.word}”` : result.length ? `Allowed but flagged: ${result.map((r) => (r.how === 'close' ? `close to “${r.word}”` : `contains “${r.word}”`)).join(', ')}` : 'Fine'}
        </span>}
      </div>
      <div className="row gap-s wrap">
        <input className="input" value={word} placeholder="Add a word" onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && word.trim().length > 1) void run(() => A.addWord(word, level), 'Added').then((ok) => { if (ok) { setWord(''); void load(); } }); }} />
        <div className="seg">{GROUPS.map(([l, n]) => <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{n}</button>)}</div>
        <button className="btn sm" disabled={word.trim().length < 2} onClick={() => run(() => A.addWord(word, level), 'Added').then((ok) => { if (ok) { setWord(''); void load(); } })}><Plus size={13} /> Add</button>
      </div>
      {!list ? <p className="muted">Loading…</p> : GROUPS.map(([l, n, hint]) => (
        <details key={l} className="word-group" open={l !== 'block'}>
          <summary><b>{n}</b> <span className="muted small">({list.filter((w) => w.level === l).length}) {hint}</span></summary>
          <div className="chips">{list.filter((w) => w.level === l).map((w) => <span key={w.word} className={'word-chip ' + l}>{w.word}<button aria-label={`Remove ${w.word}`} onClick={() => run(() => A.removeWord(w.word)).then(() => load())}><X size={11} /></button></span>)}</div>
        </details>
      ))}
    </section>
  );
}
function Reserved() {
  const [list, setList] = useState<A.Reserved[]>([]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const load = () => A.reserved().then(setList).catch((e) => toast(e.message));
  useEffect(() => { void load(); }, []);
  const clean = name.trim();
  const ok = specialNameOk(clean);
  return (
    <section className="col gap-s">
      <h3 className="sec-title">Reserved usernames</h3>
      <p className="muted small">Nobody can pick these themselves. To give one to someone, rename them under People.</p>
      <div className="row gap-s wrap">
        <input className="input mono" placeholder="username" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input grow" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary sm" disabled={!ok} onClick={() => run(() => A.reserve(clean, note.trim()), `@${clean} reserved`).then((r) => { if (r) { setName(''); setNote(''); void load(); } })}><Lock size={13} /> Reserve</button>
      </div>
      {name && !ok && <span className="small danger-text">1–24 characters, no spaces</span>}
      {!list.length ? <p className="muted small">No reserved names yet. Ideas: admin, writell, support, official.</p> : (
        <ul className="reserved-list">{list.map((r) => (
          <li key={r.name}><span className="mono">@{r.name}</span><span className="muted small grow">{r.note}</span><button className="icon-btn sm" aria-label={`Free @${r.name}`} title="Free this name" onClick={() => run(() => A.unreserve(r.name), 'Name freed').then(() => load())}><X size={13} /></button></li>
        ))}</ul>
      )}
    </section>
  );
}

/* ---------------- log ---------------- */
function LogTab() {
  const [rows, setRows] = useState<A.LogRow[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useCatalog();
  useEffect(() => {
    void A.log().then(setRows).catch((e) => { toast(e.message); setRows([]); });
    void A.people('').then((l) => setNames(new Map(l.map((p) => [p.id, '@' + p.username])))).catch(() => {});
  }, []);
  const n = (id: string | null) => (id ? names.get(id) ?? 'someone' : '');
  const when = (v: unknown) => (String(v).startsWith('9999') ? 'forever' : `until ${new Date(String(v)).toLocaleString()}`);
  const describe = (r: A.LogRow) => {
    if (r.action === 'rank') return `${n(r.target)}: role set to ${r.details === 'none' ? 'member' : roleOf(r.details)?.name ?? r.details}`;
    if (r.action === 'wipe') return `${n(r.target)}: removed ${r.details} chat message${r.details === '1' ? '' : 's'}`;
    let d: Record<string, unknown> = {}; try { d = JSON.parse(r.details ?? '{}'); } catch { /* */ }
    const parts: string[] = [];
    if ('username' in d) parts.push(`renamed to @${d.username}`);
    if ('display_name' in d && !('username' in d)) parts.push(`changed the display name to “${d.display_name}”`);
    if ('badges' in d) parts.push(`set badges ${(d.badges as string[]).map((b) => badgeOf(b)?.emoji ?? '?').join(' ') || '(none)'}`);
    if ('name_color' in d) parts.push(d.name_color ? `colored the name ${d.name_color}` : 'removed the name color');
    if ('title' in d) parts.push(d.title ? `gave the title “${d.title}”` : 'removed the title');
    if ('name_locked' in d) parts.push(d.name_locked ? 'locked the name' : 'unlocked the name');
    if ('banned_until' in d) parts.push(d.banned_until ? `banned ${when(d.banned_until)}` : 'unbanned');
    if ('chat_muted_until' in d) parts.push(d.chat_muted_until ? `muted in chats ${when(d.chat_muted_until)}` : 'unmuted in chats');
    if ('bio' in d) parts.push('cleared the bio');
    if (!parts.length) parts.push('removed the picture');
    return `${n(r.target)}: ${parts.join(', ')}`;
  };
  if (!rows) return <p className="muted">Loading…</p>;
  if (!rows.length) return <p className="muted small">Nothing yet. Every change made with the admin tools is listed here.</p>;
  return (
    <ul className="admin-log">{rows.map((r) => (
      <li key={r.id}><span className="mono small">{n(r.actor)}</span><span className="grow">{describe(r)}</span><span className="muted small">{timeAgo(Date.parse(r.at))}</span></li>
    ))}</ul>
  );
}
