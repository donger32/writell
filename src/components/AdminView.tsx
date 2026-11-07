/* Admin: overview, people (rename, badges, colors, titles, ranks, bans), announcements, fun effects, reserved names, log */
import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Ban, Crown, Dice5, Lock, Unlock, Megaphone, PartyPopper, RefreshCw, Search, Sparkles, Snowflake, Heart, Vibrate, Star, Trash2, UserX, Users, X, ScrollText, AtSign,
} from 'lucide-react';
import { useSocial } from '../social/api';
import { BADGES, NAME_COLORS, STAFF_LABEL, badge, rankOf, sillyName } from '../social/badges';
import * as A from '../social/admin';
import { playLocal } from '../social/effects';
import { currentUserId } from '../sync/engine';
import { Modal, confirmDialog, promptDialog, toast } from './ui';
import { StaffMark, Badges } from './UserName';
import { Avatar } from './story/common';
import { timeAgo } from '../util';

type Tab = 'overview' | 'people' | 'announce' | 'fun' | 'names' | 'log';
const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok); return true; } catch (e) { toast((e as Error).message); return false; } };
const fx = (kind: A.FxKind, target: string | null = null, text: string | null = null) => {
  const me = currentUserId()!;
  return run(async () => { await A.sendFx(kind, target, text); if (!target || target === me) playLocal({ id: 0, kind, target, text, created_by: me, created_at: new Date().toISOString() }); });
};
const TITLES = ['Supreme Wordlord', 'Comma Criminal', 'Plot Hole Inspector', 'Keeper of Lore', 'Professional Procrastinator', 'Chief Villain Officer', 'Typo Goblin', 'Cliffhanger Enjoyer'];

export function AdminView() {
  const social = useSocial();
  const myRank = rankOf(social.me?.staff);
  const [tab, setTab] = useState<Tab>('overview');
  if (!social.ready) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!myRank) return <div className="page"><h1>Admin</h1><p className="muted">Only Writell staff can open this page.</p></div>;
  const TABS: [Tab, string, typeof Users][] = [['overview', 'Overview', Activity], ['people', 'People', Users], ['announce', 'Announce', Megaphone], ['fun', 'Fun', Sparkles], ['names', 'Reserved names', AtSign], ['log', 'Log', ScrollText]];
  return (
    <div className="page admin-page">
      <header className="admin-head">
        <span className={'admin-crest ' + social.me!.staff}><StaffMark staff={social.me!.staff} size={22} /></span>
        <div className="col">
          <h1>Admin</h1>
          <span className="muted small">You’re {social.me!.staff === 'owner' ? 'the Writell owner' : `a${social.me!.staff === 'admin' ? 'n' : ''} ${STAFF_LABEL[social.me!.staff!].toLowerCase()}`}. Writing and chats stay encrypted: admins can’t read them.</span>
        </div>
      </header>
      <div className="admin-tabs" role="tablist">
        {TABS.filter(([t]) => myRank >= 2 || (t !== 'announce' && t !== 'names')).map(([t, l, I]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}><I size={15} /> {l}</button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab onPeople={() => setTab('people')} />}
      {tab === 'people' && <PeopleTab myRank={myRank} />}
      {tab === 'announce' && <AnnounceTab />}
      {tab === 'fun' && <FunTab />}
      {tab === 'names' && <NamesTab />}
      {tab === 'log' && <LogTab />}
    </div>
  );
}

function OverviewTab({ onPeople }: { onPeople: () => void }) {
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
  ];
  return (
    <>
      <div className="stat-tiles">
        {tiles.map(([l, n, k]) => <div key={l} className={'stat-tile' + (k ? ' ' + k : '')}><span className="stat-n">{n.toLocaleString()}</span><span className="stat-l">{l}</span></div>)}
      </div>
      <div className="row gap-s"><button className="btn sm" onClick={onPeople}><Users size={13} /> See everyone</button><button className="btn ghost sm" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button></div>
    </>
  );
}

function PeopleTab({ myRank }: { myRank: number }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<A.Person[] | null>(null);
  const [open, setOpen] = useState<A.Person | null>(null);
  const [error, setError] = useState('');
  const load = (query = q) => A.people(query).then((l) => { setList(l); setError(''); setOpen((o) => (o ? l.find((x) => x.id === o.id) ?? o : o)); }).catch((e) => setError(e.message));
  useEffect(() => { const t = window.setTimeout(() => void load(q), 250); return () => window.clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const online = (p: A.Person) => p.last_seen && Date.now() - Date.parse(p.last_seen) < 180_000;
  return (
    <>
      <div className="search-box admin-search"><Search size={15} /><input className="input" placeholder="Search by username or name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {error && <p className="danger-text small">{error}</p>}
      {!list ? <p className="muted">Loading…</p> : !list.length ? <p className="muted">Nobody found.</p> : (
        <ul className="people admin-people">
          {list.map((p) => (
            <li key={p.id} className="person">
              <button className="person-main" onClick={() => setOpen(p)}>
                <span className="avatar-wrap"><Avatar name={p.display_name || p.username} size={36} /><span className={'online-dot' + (online(p) ? ' on' : '')} /></span>
                <span className="col" style={{ minWidth: 0 }}>
                  <strong className="ellipsis"><span className={'uname-text' + (p.name_color ? ' nc-' + p.name_color : '')}>{p.display_name || p.username}</span> <StaffMark staff={p.staff} /> <Badges ids={p.badges} max={4} /></strong>
                  <span className="muted small ellipsis">@{p.username}{p.title ? ` · ${p.title}` : ''} · {online(p) ? 'online now' : p.last_seen ? `seen ${timeAgo(Date.parse(p.last_seen))}` : 'never seen'}</span>
                </span>
              </button>
              <span className="person-actions">
                {p.banned_until && Date.parse(p.banned_until) > Date.now() && <span className="role-pill danger">Banned</span>}
                {p.name_locked && <span className="role-pill" title="Name locked"><Lock size={11} /></span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && <PersonEditor p={open} myRank={myRank} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </>
  );
}

const BAN_TIMES: [string, number | null][] = [['10 minutes', 10 / 60], ['1 hour', 1], ['1 day', 24], ['1 week', 168], ['Forever', null]];
function PersonEditor({ p, myRank, onClose, onChanged }: { p: A.Person; myRank: number; onClose: () => void; onChanged: () => void }) {
  const me = currentUserId();
  const self = p.id === me;
  const canTouch = self || rankOf(p.staff) < myRank;
  const [username, setUsername] = useState(p.username);
  const [display, setDisplay] = useState(p.display_name);
  const [title, setTitle] = useState(p.title ?? '');
  const [banFor, setBanFor] = useState(1);
  const [reason, setReason] = useState('');
  useEffect(() => { setUsername(p.username); setDisplay(p.display_name); setTitle(p.title ?? ''); }, [p.username, p.display_name, p.title]);
  const name = p.display_name || p.username;
  const change = async (c: A.Changes, ok: string) => { if (await run(() => A.update(p.id, c), ok)) onChanged(); };
  const banned = p.banned_until && Date.parse(p.banned_until) > Date.now();
  const toggleBadge = (id: string) => change({ badges: p.badges.includes(id) ? p.badges.filter((b) => b !== id) : [...p.badges, id] }, p.badges.includes(id) ? `Took away ${badge(id)?.label}` : `Gave ${name} “${badge(id)?.label}” ${badge(id)?.emoji}`);
  const unameOk = /^[a-z0-9_]{3,20}$/.test(username);
  return (
    <Modal title={`@${p.username}`} onClose={onClose}>
      <div className="pad col gap admin-editor">
        <div className="row gap">
          <Avatar name={name} size={56} />
          <div className="col grow" style={{ minWidth: 0 }}>
            <strong className="me-name ellipsis"><span className={'uname-text' + (p.name_color ? ' nc-' + p.name_color : '')}>{name}</span> <StaffMark staff={p.staff} /></strong>
            <span className="muted small">Joined {new Date(p.created_at).toLocaleDateString()} · {p.friends} friends · in {p.projects} shared projects{p.last_seen ? ` · seen ${timeAgo(Date.parse(p.last_seen))}` : ''}</span>
            {p.title && <span className="u-title big">{p.title}</span>}
          </div>
        </div>
        {!canTouch && <p className="small danger-text">{name} has the same rank as you or higher, so you can’t change them.</p>}
        <fieldset disabled={!canTouch} className="col gap admin-fields">
          <section>
            <h4>Name</h4>
            <div className="row gap-s wrap">
              <label className="field grow"><span>Username</span><input className="input mono" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} /></label>
              <label className="field grow"><span>Display name</span><input className="input" value={display} maxLength={40} onChange={(e) => setDisplay(e.target.value)} /></label>
            </div>
            <div className="row gap-s wrap">
              <button className="btn primary sm" disabled={!unameOk || (username === p.username && display === p.display_name)} onClick={() => change({ ...(username !== p.username ? { username } : {}), ...(display !== p.display_name ? { display_name: display } : {}) }, 'Name changed')}>Save name</button>
              <button className="btn sm" onClick={() => { const n = sillyName(); change({ username: n, display_name: n.replace(/_/g, ' ').replace(/\d+$/, '').replace(/\b\w/g, (c) => c.toUpperCase()).trim() }, `${name} is now @${n} 🎲`); }}><Dice5 size={13} /> Surprise rename</button>
              <button className="btn ghost sm" onClick={() => change({ name_locked: !p.name_locked }, p.name_locked ? 'Name unlocked' : `Locked: ${name} can’t change their name`)}>{p.name_locked ? <><Unlock size={13} /> Unlock name</> : <><Lock size={13} /> Lock name</>}</button>
            </div>
            {!unameOk && <span className="small danger-text">3–20 lowercase letters, numbers or _</span>}
          </section>
          <section>
            <h4>Title</h4>
            <div className="row gap-s"><input className="input grow" value={title} maxLength={40} placeholder="Shown under their name" onChange={(e) => setTitle(e.target.value)} /><button className="btn sm" disabled={title === (p.title ?? '')} onClick={() => change({ title: title.trim() || null }, title.trim() ? 'Title given' : 'Title removed')}>Save</button></div>
            <div className="chips">{TITLES.map((t) => <button key={t} className="count-chip" onClick={() => setTitle(t)}>{t}</button>)}</div>
          </section>
          <section>
            <h4>Name color</h4>
            <div className="swatches">
              <button className={'swatch none' + (!p.name_color ? ' on' : '')} title="None" onClick={() => change({ name_color: null }, 'Color removed')}><X size={12} /></button>
              {NAME_COLORS.map((c) => <button key={c.id} className={'swatch' + (p.name_color === c.id ? ' on' : '')} title={c.label} style={{ background: c.swatch }} onClick={() => change({ name_color: c.id }, `${name}’s name is now ${c.label.toLowerCase()}`)} />)}
            </div>
          </section>
          <section>
            <h4>Badges</h4>
            <div className="badge-grid">{BADGES.map((b) => <button key={b.id} className={'badge-toggle' + (p.badges.includes(b.id) ? ' on' : '')} onClick={() => toggleBadge(b.id)} aria-pressed={p.badges.includes(b.id)}><span>{b.emoji}</span>{b.label}</button>)}</div>
          </section>
          {myRank >= 3 && !self && (
            <section>
              <h4>Staff rank</h4>
              <div className="seg">
                {([null, 'mod', 'admin'] as const).map((r) => <button key={String(r)} className={(p.staff ?? null) === r ? 'on' : ''} onClick={() => run(() => A.setStaff(p.id, r), r ? `${name} is now ${r === 'admin' ? 'an admin' : 'a moderator'}` : 'Rank removed').then((ok) => ok && onChanged())}>{r === null ? 'None' : r === 'mod' ? <><StaffMark staff="mod" /> Moderator</> : <><StaffMark staff="admin" /> Admin</>}</button>)}
              </div>
              <p className="muted small">Moderators can rename, give badges and ban. Admins can also post announcements and reserve names. Only you can change ranks.</p>
            </section>
          )}
          {!self && (
            <section>
              <h4>Fun</h4>
              <div className="row gap-s wrap">
                <button className="btn sm" onClick={() => fx('confetti', p.id).then((ok) => ok && toast(`Confetti sent to ${name} 🎉`))}><PartyPopper size={13} /> Confetti</button>
                <button className="btn sm" onClick={() => fx('hearts', p.id).then((ok) => ok && toast('Hearts sent 💖'))}><Heart size={13} /> Hearts</button>
                <button className="btn sm" onClick={() => fx('shake', p.id).then((ok) => ok && toast(`${name}’s screen wobbles`))}><Vibrate size={13} /> Shake</button>
                <button className="btn sm" onClick={async () => { const t = await promptDialog(`Shout at ${name}`, '', 'Send'); if (t?.trim()) void fx('shout', p.id, t.trim().slice(0, 200)).then((ok) => ok && toast('Shout sent 📣')); }}><Megaphone size={13} /> Shout</button>
                <button className="btn sm" onClick={() => fx('spotlight', null, p.id).then((ok) => ok && toast(`Everyone sees ${name} in the spotlight 🌟`))}><Star size={13} /> Spotlight for everyone</button>
              </div>
              <p className="muted small">Shows up on their screen if they have Writell open (within a few seconds).</p>
            </section>
          )}
          {!self && (
            <section>
              <h4>Moderation</h4>
              {banned ? (
                <div className="row gap-s wrap"><span className="small danger-text grow">Banned until {new Date(p.banned_until!).toLocaleString()}{p.ban_reason ? `: ${p.ban_reason}` : ''}</span>
                  <button className="btn sm" onClick={() => change({ banned_until: null, ban_reason: null }, `${name} is unbanned`)}>Unban</button></div>
              ) : (
                <div className="row gap-s wrap">
                  <select className="pill-select" value={banFor < 0 ? 'null' : String(banFor)} onChange={(e) => setBanFor(e.target.value === 'null' ? -1 : Number(e.target.value))} aria-label="Ban for">{BAN_TIMES.map(([l, h]) => <option key={l} value={h === null ? 'null' : String(h)}>{l}</option>)}</select>
                  <input className="input sm grow" placeholder="Reason (they see it)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
                  <button className="btn sm danger" onClick={async () => {
                    if (!(await confirmDialog(`Ban ${name}?`, 'They can’t chat in shared projects or send friend requests until it ends. Their own writing and sync keep working.', { danger: true, ok: 'Ban' }))) return;
                    const until = banFor < 0 ? '9999-12-31T00:00:00Z' : new Date(Date.now() + banFor * 3600_000).toISOString();
                    void change({ banned_until: until, ban_reason: reason.trim() || null }, `${name} is banned`);
                  }}><Ban size={13} /> Ban</button>
                </div>
              )}
              <div className="row gap-s wrap">
                {p.bio && <button className="btn ghost sm" onClick={() => change({ bio: '' }, 'Bio cleared')}><X size={13} /> Clear bio</button>}
                {p.has_avatar && <button className="btn ghost sm" onClick={() => change({ avatar: null }, 'Picture removed')}><UserX size={13} /> Remove picture</button>}
              </div>
            </section>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}

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

function FunTab() {
  const [shout, setShout] = useState('');
  const [who, setWho] = useState<A.Person[]>([]);
  const [spot, setSpot] = useState('');
  useEffect(() => { void A.people('').then(setWho).catch(() => {}); }, []);
  const online = useMemo(() => who.filter((p) => p.last_seen && Date.now() - Date.parse(p.last_seen) < 180_000).length, [who]);
  const B = ({ k, icon, label, hint }: { k: A.FxKind; icon: React.ReactNode; label: string; hint: string }) => (
    <button className="fun-card" onClick={() => fx(k).then((ok) => ok && toast(`${label} for everyone!`))}><span className="fun-icon">{icon}</span><strong>{label}</strong><span className="muted small">{hint}</span></button>
  );
  return (
    <div className="col gap">
      <p className="muted small">These pop up on the screen of everyone who has Writell open right now{online ? ` (about ${online})` : ''}. Want to hit just one person? Open them under People.</p>
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
      <p className="muted small">Shows their card with confetti on everyone’s screen. Nice with the 🌟 Writer of the week badge.</p>
    </div>
  );
}

function NamesTab() {
  const [list, setList] = useState<A.Reserved[]>([]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const load = () => A.reserved().then(setList).catch((e) => toast(e.message));
  useEffect(() => { void load(); }, []);
  const clean = name.trim().toLowerCase().replace(/^@/, '');
  const ok = /^[a-z0-9_]{3,20}$/.test(clean);
  return (
    <div className="col gap">
      <p className="muted small">Nobody can pick these usernames themselves. To give one to someone, open them under People and rename them: admins can use reserved names.</p>
      <div className="row gap-s wrap">
        <input className="input mono" placeholder="username" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input grow" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary" disabled={!ok} onClick={() => run(() => A.reserve(clean, note.trim()), `@${clean} reserved`).then((r) => { if (r) { setName(''); setNote(''); void load(); } })}><Crown size={14} /> Reserve</button>
      </div>
      {name && !ok && <span className="small danger-text">3–20 lowercase letters, numbers or _</span>}
      {!list.length ? <p className="muted small">No reserved names yet. Ideas: admin, writell, support, official.</p> : (
        <ul className="reserved-list">{list.map((r) => (
          <li key={r.name}><span className="mono">@{r.name}</span><span className="muted small grow">{r.note}</span><button className="icon-btn sm" aria-label={`Free @${r.name}`} title="Free this name" onClick={() => run(() => A.unreserve(r.name), 'Name freed').then(() => load())}><X size={13} /></button></li>
        ))}</ul>
      )}
    </div>
  );
}

function LogTab() {
  const [rows, setRows] = useState<A.LogRow[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void A.log().then(setRows).catch((e) => toast(e.message));
    void A.people('').then((l) => setNames(new Map(l.map((p) => [p.id, '@' + p.username]))));
  }, []);
  const n = (id: string | null) => (id ? names.get(id) ?? 'someone' : '');
  const describe = (r: A.LogRow) => {
    if (r.action === 'rank') return `made ${n(r.target)} ${r.details === 'none' ? 'a regular member' : r.details === 'admin' ? 'an admin' : 'a moderator'}`;
    let d: Record<string, unknown> = {}; try { d = JSON.parse(r.details ?? '{}'); } catch { /* */ }
    const parts: string[] = [];
    if ('username' in d) parts.push(`renamed to @${d.username}`);
    if ('display_name' in d && !('username' in d)) parts.push(`changed the display name to “${d.display_name}”`);
    if ('badges' in d) parts.push(`set badges ${(d.badges as string[]).map((b) => badge(b)?.emoji ?? b).join(' ') || '(none)'}`);
    if ('name_color' in d) parts.push(d.name_color ? `colored the name ${d.name_color}` : 'removed the name color');
    if ('title' in d) parts.push(d.title ? `gave the title “${d.title}”` : 'removed the title');
    if ('name_locked' in d) parts.push(d.name_locked ? 'locked the name' : 'unlocked the name');
    if ('banned_until' in d) parts.push(d.banned_until ? `banned until ${new Date(String(d.banned_until)).toLocaleString()}` : 'unbanned');
    if ('bio' in d) parts.push('cleared the bio');
    if (r.details && !r.details.includes('avatar') && !parts.length) parts.push('changed something');
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

