/* Project chat: messages, comments and changes in one Discord-style feed */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Check, CornerUpLeft, Crosshair, EyeOff, FilePlus2, FileMinus2, MessageSquareQuote, MessagesSquare, Pencil, RotateCcw, SendHorizontal, Trash2, X, Ban, Bell, BellOff, User,
} from 'lucide-react';
import { db } from '../db';
import { go } from '../nav';
import { currentUserId, useSharedRoles } from '../sync/engine';
import { useSocial, block, unblock, getProfiles, isBanned, type Profile } from '../social/api';
import { listMembers, ROLE_LABEL, type Member } from '../social/share';
import {
  canModerate, chatVisible, editMessage, ensureReadMark, markRead, post, refreshChat, removeMessage, setResolved, useChat, type Msg,
} from '../social/chat';
import { isMuted, setMuted, useMuted } from '../social/mute';
import { follow, useFollowing, useProjectPeople } from '../social/presence';
import { revealComment } from '../social/reveal';
import { Avatar } from './story/common';
import { UserName, displayName } from './UserName';
import { ProfileModal } from './FriendsView';
import { userColor } from './CoWriters';
import { confirmDialog, openMenu, toast } from './ui';

type Filter = 'all' | 'msg' | 'comment' | 'activity';
const FILTERS: [Filter, string][] = [['all', 'All'], ['msg', 'Messages'], ['comment', 'Comments'], ['activity', 'Changes']];
const GROUP_MS = 7 * 60_000;
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function day(iso: string) {
  const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
}
const snippet = (m?: Msg) => {
  if (!m) return 'Original message was removed';
  if (m.kind === 'activity') return activityText(m, () => '').replace(/\s+/g, ' ');
  return (m.body?.text ?? '').replace(/\s+/g, ' ').slice(0, 90) || '…';
};
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g);
  return <>{parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : <Fragment key={i}>{p}</Fragment>))}</>;
}
const NOUN: Record<string, string> = { chapter: 'chapter', scene: 'scene', character: 'character', world: 'world entry', note: 'note', event: 'event', timeline: 'timeline', familytree: 'family tree', relmap: 'relation map', map: 'map', task: 'task' };
function list(items: { t: string; label: string }[]) {
  const named = items.map((i) => `${NOUN[i.t] ?? i.t} “${i.label || 'Untitled'}”`);
  return named.length > 3 ? `${named.slice(0, 3).join(', ')} and ${named.length - 3} more` : named.join(', ').replace(/, ([^,]*)$/, ' and $1');
}
function activityText(m: Msg, name: (id: string) => string) {
  const b = m.body; if (!b) return '';
  const who = name(m.author);
  if (b.type === 'edit') return `${who} wrote in “${b.scene || 'a scene'}”`;
  const a = b.items?.added ?? [], r = b.items?.removed ?? [];
  return [who, a.length ? `added ${list(a)}` : '', a.length && r.length ? 'and' : '', r.length ? `removed ${list(r)}` : ''].filter(Boolean).join(' ');
}

export function ChatPanel({ projectId, compact, onClose, focusId }: { projectId: string; compact?: boolean; onClose?: () => void; focusId?: string }) {
  const chat = useChat(projectId);
  const social = useSocial();
  const muted = useMuted();
  const here = useProjectPeople(projectId);
  const following = useFollowing();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const uid = currentUserId();
  const mod = canModerate(projectId);
  const [members, setMembers] = useState<Member[]>([]);
  const [extra, setExtra] = useState<Map<string, Profile>>(new Map());
  const [filter, setFilter] = useState<Filter>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void refreshChat(projectId); chatVisible(projectId, true); return () => chatVisible(projectId, false); }, [projectId]);
  useEffect(() => {
    let alive = true;
    const load = () => listMembers(projectId).then((m) => alive && setMembers(m)).catch(() => {});
    load(); const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [projectId]);
  // people who posted but aren't members anymore
  const people = useMemo(() => new Map([...extra, ...members.filter((m) => m.profile).map((m) => [m.user_id, m.profile!] as const)]), [members, extra]);
  useEffect(() => {
    const missing = [...new Set(chat.msgs.map((m) => m.author))].filter((a) => !people.has(a));
    if (missing.length) void getProfiles(missing).then((got) => setExtra((e) => new Map([...e, ...got])));
  }, [chat.msgs, people]);
  const roleOf = (id: string) => members.find((m) => m.user_id === id)?.role;
  const nameOf = (id: string) => (id === uid && social.me ? displayName(social.me) : displayName(people.get(id)));

  // read & scroll
  useEffect(() => { if (chat.loaded) { ensureReadMark(projectId); if (document.visibilityState === 'visible') markRead(projectId); } }, [chat.msgs, chat.loaded, projectId]);
  useLayoutEffect(() => { const el = scroller.current; if (el && atBottom.current) el.scrollTop = el.scrollHeight; }, [chat.msgs, filter, showResolved]);
  useEffect(() => {
    if (!focusId) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById('m-' + focusId);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); window.setTimeout(() => el.classList.remove('flash'), 1600); }
    }, 120);
    return () => window.clearTimeout(t);
  }, [focusId, chat.loaded]);
  const onScroll = () => { const el = scroller.current; if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; };

  const hiddenBy = (a: string) => (a !== uid && (social.blocked.some((b) => b.id === a) ? 'blocked' : muted.includes(a) ? 'muted' : null));
  const visibleMsgs = chat.msgs.filter((m) => (filter === 'all' || m.kind === filter) && (filter !== 'comment' || showResolved || !m.resolved));
  const openComments = chat.msgs.filter((m) => m.kind === 'comment' && !m.resolved).length;
  const banned = isBanned(social.me);

  const send = async () => {
    const t = text.trim(); if (!t || sending) return;
    setSending(true); setText(''); const r = replyTo; setReplyTo(null); atBottom.current = true;
    try { await post(projectId, 'msg', { text: t }, r?.id); }
    catch (e) { toast((e as Error).message); setText(t); setReplyTo(r); }
    finally { setSending(false); input.current?.focus(); }
  };
  const saveEdit = async () => {
    if (!editing) return; const m = chat.byId.get(editing.id); const t = editing.text.trim();
    setEditing(null);
    if (!m || !t || t === m.body?.text) return;
    try { await editMessage(projectId, m.id, { ...m.body, text: t }); } catch (e) { toast((e as Error).message); }
  };
  const del = async (m: Msg) => {
    const mine = m.author === uid;
    if (!(await confirmDialog(mine ? 'Delete this message?' : `Remove ${nameOf(m.author)}’s message?`, m.kind === 'comment' ? 'The comment and its highlight disappear for everyone.' : 'It disappears for everyone in the project.', { danger: true, ok: mine ? 'Delete' : 'Remove' }))) return;
    try { await removeMessage(projectId, m.id); } catch (e) { toast((e as Error).message); }
  };
  const resolve = async (m: Msg) => { try { await setResolved(projectId, m.id, !m.resolved); } catch (e) { toast((e as Error).message); } };
  const reply = (m: Msg) => { setReplyTo(m); setEditing(null); input.current?.focus(); };
  const jump = (id: string) => {
    if (filter !== 'all') setFilter('all');
    window.setTimeout(() => { const el = document.getElementById('m-' + id); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); window.setTimeout(() => el.classList.remove('flash'), 1600); } else toast('That message isn’t loaded anymore'); }, 50);
  };
  const personMenu = (e: React.MouseEvent, id: string) => {
    if (id === uid) { const p = social.me; if (p) setProfile(p); return; }
    const p = people.get(id); const w = here.find((x) => x.u === id);
    const isBlocked = social.blocked.some((b) => b.id === id);
    openMenu(e, [
      ...(p ? [{ label: 'View profile', icon: <User size={14} />, onClick: () => setProfile(p) }] : []),
      ...(w ? [{ label: following?.u === id ? 'Following' : `Follow ${nameOf(id)}`, icon: <Crosshair size={14} />, onClick: () => { follow(projectId, id); toast(`Following ${nameOf(id)}: you’ll go where they write`); } }] : []),
      { label: muted.includes(id) ? 'Unmute' : 'Mute', icon: muted.includes(id) ? <Bell size={14} /> : <BellOff size={14} />, onClick: () => { setMuted(id, !isMuted(id)); toast(isMuted(id) ? `Muted ${nameOf(id)}: their messages are folded away` : 'Unmuted'); } },
      isBlocked
        ? { label: 'Unblock', icon: <Ban size={14} />, onClick: () => { void unblock(id).catch((er) => toast(er.message)); } }
        : { label: 'Block…', icon: <Ban size={14} />, danger: true, onClick: async () => { if (await confirmDialog(`Block ${nameOf(id)}?`, 'Their messages are hidden from you, you stop being friends, and they can’t find you. They stay in this project (the owner decides that) and aren’t told.', { danger: true, ok: 'Block' })) void block(id).then(() => toast('Blocked')).catch((er) => toast(er.message)); } },
    ]);
  };

  // build the feed: day dividers, grouping, folded muted runs
  const rows: React.ReactNode[] = [];
  let prev: Msg | null = null; let lastDay = '';
  for (let i = 0; i < visibleMsgs.length; i++) {
    const m = visibleMsgs[i];
    const d = day(m.created_at);
    if (d !== lastDay) { rows.push(<div key={'d' + m.id} className="cm-day"><span>{d}</span></div>); lastDay = d; prev = null; }
    const hid = hiddenBy(m.author);
    if (hid && !shown.has(m.id)) {
      // fold a run of hidden messages into one line
      const run = [m]; while (i + 1 < visibleMsgs.length && hiddenBy(visibleMsgs[i + 1].author) && !shown.has(visibleMsgs[i + 1].id) && day(visibleMsgs[i + 1].created_at) === d) run.push(visibleMsgs[++i]);
      rows.push(<div key={'h' + m.id} className="cm-hidden"><EyeOff size={13} /> {run.length === 1 ? 'A message' : `${run.length} messages`} from {hid === 'blocked' ? 'someone you blocked' : 'someone you muted'} <button className="link" onClick={() => setShown((s) => new Set([...s, ...run.map((x) => x.id)]))}>Show</button></div>);
      prev = null; continue;
    }
    if (m.kind === 'activity') {
      const b = m.body;
      rows.push(
        <div key={m.id} id={'m-' + m.id} className={'cm-activity' + (active === m.id ? ' active' : '')} onClick={() => setActive(active === m.id ? null : m.id)}>
          <span className="cm-act-icon">{b?.type === 'edit' ? <Pencil size={13} /> : b?.items?.added?.length ? <FilePlus2 size={13} /> : <FileMinus2 size={13} />}</span>
          <span className="cm-act-text">
            {b?.type === 'edit' ? <>
              <button className="cm-name-link" onClick={(e) => { e.stopPropagation(); personMenu(e, m.author); }}>{nameOf(m.author)}</button> wrote in{' '}
              <button className="link" onClick={(e) => { e.stopPropagation(); if (b.sceneId) go({ view: 'write', projectId, sceneId: b.sceneId }); }}>“{b.scene || 'a scene'}”</button>
              {' '}<span className="cm-words">{b.added ? <span className="plus">+{b.added}</span> : null}{b.added && b.removed ? ' ' : ''}{b.removed ? <span className="minus">−{b.removed}</span> : null} words</span>
            </> : activityText(m, nameOf)}
            <span className="cm-time">{time(m.edited_at ?? m.created_at)}</span>
          </span>
          {actions(m)}
        </div>,
      );
      prev = null; continue;
    }
    const grouped = !!prev && prev.author === m.author && prev.kind === 'msg' && m.kind === 'msg' && !m.reply_to && Date.parse(m.created_at) - Date.parse(prev.created_at) < GROUP_MS;
    const p = m.author === uid ? social.me : people.get(m.author);
    const r = m.reply_to ? chat.byId.get(m.reply_to) : undefined;
    rows.push(
      <div key={m.id} id={'m-' + m.id} className={'cm-row' + (grouped ? ' grouped' : '') + (m.kind === 'comment' ? ' is-comment' : '') + (m.resolved ? ' resolved' : '') + (m.pending ? ' pending' : '') + (active === m.id ? ' active' : '')}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, textarea')) setActive(active === m.id ? null : m.id); }}>
        {m.reply_to && (
          <button className="cm-replyref" onClick={() => r && !r.deleted ? jump(r.id) : toast('That message was removed')}>
            <CornerUpLeft size={12} />
            {r && !r.deleted ? <><span className="cm-replyname" style={{ color: userColor(r.author) }}>{nameOf(r.author)}</span><span className="ellipsis">{r.kind === 'comment' ? '💬 ' : ''}{snippet(r)}</span></> : <em>Original message was removed</em>}
          </button>
        )}
        <div className="cm-main">
          {grouped ? <span className="cm-gutter-time">{time(m.created_at)}</span>
            : <button className="cm-avatar" onClick={(e) => personMenu(e, m.author)} aria-label={`About ${nameOf(m.author)}`}><Avatar name={nameOf(m.author)} image={p?.avatar ?? undefined} size={36} /></button>}
          <div className="cm-body">
            {!grouped && (
              <div className="cm-head">
                <button className="cm-name" onClick={(e) => personMenu(e, m.author)}><UserName p={p} fallback={nameOf(m.author)} max={2} /></button>
                {roleOf(m.author) && roleOf(m.author) !== 'editor' && <span className={'cm-role ' + roleOf(m.author)}>{ROLE_LABEL[roleOf(m.author)!]}</span>}
                <span className="cm-time">{time(m.created_at)}</span>
              </div>
            )}
            {m.kind === 'comment' && m.body && (
              <button className="cm-quote" onClick={() => m.body?.sceneId && revealComment(projectId, m.body.sceneId, m.id)} title="Show in the text">
                <MessageSquareQuote size={13} />
                <span className="ellipsis">Comment on <b>{m.body.scene || 'a scene'}</b>: “{m.body.quote}”</span>
              </button>
            )}
            {editing?.id === m.id ? (
              <div className="cm-edit">
                <textarea className="input" autoFocus value={editing.text} rows={Math.min(8, editing.text.split('\n').length + 1)} onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit(); } if (e.key === 'Escape') setEditing(null); }} />
                <span className="muted small">Enter to save · Esc to cancel</span>
              </div>
            ) : (
              <div className="cm-text"><Linkified text={m.body?.text ?? ''} />{m.edited_at && <span className="cm-edited"> (edited)</span>}</div>
            )}
            {m.kind === 'comment' && m.resolved && <span className="cm-resolved"><Check size={12} /> Resolved</span>}
          </div>
        </div>
        {actions(m)}
      </div>,
    );
    prev = m;
  }

  function actions(m: Msg) {
    const mine = m.author === uid;
    if (m.pending) return null;
    return (
      <div className="cm-actions" role="toolbar" aria-label="Message actions">
        <button className="icon-btn sm" title="Reply" aria-label="Reply" onClick={(e) => { e.stopPropagation(); reply(m); }}><CornerUpLeft size={14} /></button>
        {m.kind === 'comment' && (mod || mine) && <button className="icon-btn sm" title={m.resolved ? 'Reopen comment' : 'Resolve comment'} aria-label={m.resolved ? 'Reopen' : 'Resolve'} onClick={(e) => { e.stopPropagation(); void resolve(m); }}>{m.resolved ? <RotateCcw size={14} /> : <Check size={14} />}</button>}
        {mine && m.kind !== 'activity' && <button className="icon-btn sm" title="Edit" aria-label="Edit" onClick={(e) => { e.stopPropagation(); setEditing({ id: m.id, text: m.body?.text ?? '' }); }}><Pencil size={14} /></button>}
        {(mine || mod) && <button className="icon-btn sm danger" title={mine ? 'Delete' : 'Remove (you can edit this project)'} aria-label="Delete" onClick={(e) => { e.stopPropagation(); void del(m); }}><Trash2 size={14} /></button>}
      </div>
    );
  }

  const herePeople = here.map((w) => ({ w, p: people.get(w.u) })).filter((x) => !hiddenBy(x.w.u));
  return (
    <div className={'chat' + (compact ? ' compact drawer' : '')}>
      <div className="chat-head">
        <MessagesSquare size={18} />
        <div className="col grow" style={{ minWidth: 0 }}>
          <strong className="ellipsis">{compact ? 'Chat' : `${project?.title ?? 'Project'} chat`}</strong>
          <span className="muted small ellipsis">{members.length ? `${members.length} ${members.length === 1 ? 'member' : 'members'}` : ''}{herePeople.length ? ` · ${herePeople.length} here now` : ''}</span>
        </div>
        {herePeople.length > 0 && (
          <div className="chat-here">
            {herePeople.slice(0, 4).map(({ w, p }) => (
              <button key={w.u} className={'here-av' + (following?.u === w.u ? ' following' : '')} style={{ borderColor: userColor(w.u) }} title={`${nameOf(w.u)} is here: click to follow`} onClick={(e) => personMenu(e, w.u)}>
                <Avatar name={nameOf(w.u)} image={p?.avatar ?? undefined} size={24} />
              </button>
            ))}
          </div>
        )}
        {onClose && <button className="icon-btn sm" onClick={onClose} aria-label="Close chat"><X size={14} /></button>}
      </div>
      <div className="seg chat-filter" role="tablist">
        {FILTERS.map(([f, l]) => <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => { setFilter(f); atBottom.current = true; }}>{l}{f === 'comment' && openComments ? <span className="seg-count">{openComments}</span> : null}</button>)}
      </div>
      {filter === 'comment' && <label className="check small chat-resolved"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>}
      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        {chat.error && <p className="small danger-text pad">{chat.error}</p>}
        {!chat.loaded && !chat.error && <p className="muted small pad">Loading…</p>}
        {chat.loaded && !visibleMsgs.length && (
          <div className="chat-empty">
            <MessagesSquare size={28} />
            {filter === 'comment' ? <p>No {showResolved ? '' : 'open '}comments. Select text in a scene and press <b>Comment</b>.</p>
              : filter === 'activity' ? <p>Changes show up here as people write: who wrote where, and what was added or removed.</p>
                : <p>This is the start of the chat. Say hi! Comments and changes show up here too.</p>}
          </div>
        )}
        {rows}
      </div>
      <div className="chat-compose">
        {replyTo && (
          <div className="reply-chip">
            <CornerUpLeft size={13} /> Replying to <b style={{ color: userColor(replyTo.author) }}>{nameOf(replyTo.author)}</b>
            <span className="ellipsis muted">{snippet(replyTo)}</span>
            <button className="icon-btn sm" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><X size={12} /></button>
          </div>
        )}
        {banned ? <p className="small danger-text">You’re banned from chatting until {new Date(social.me!.banned_until!).toLocaleString()}{social.me?.ban_reason ? `: ${social.me.ban_reason}` : ''}.</p> : (
          <div className="compose-row">
            <textarea ref={input} className="input chat-input" rows={1} value={text} placeholder={replyTo ? 'Write a reply…' : `Message ${project?.title ?? 'the project'}`} aria-label="Message"
              onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'; }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
                if (e.key === 'Escape' && replyTo) { e.stopPropagation(); setReplyTo(null); }
                if (e.key === 'ArrowUp' && !text) { const mine = [...chat.msgs].reverse().find((m) => m.author === uid && m.kind !== 'activity'); if (mine) { e.preventDefault(); setEditing({ id: mine.id, text: mine.body?.text ?? '' }); } }
              }} />
            <button className="btn primary send-btn" disabled={!text.trim() || sending} onClick={() => void send()} aria-label="Send"><SendHorizontal size={16} /></button>
          </div>
        )}
      </div>
      {profile && <ProfileModal p={profile} onClose={() => setProfile(null)} />}
    </div>
  );
}

/** The whole-page version (sidebar → Chat) */
export function ChatView({ projectId, focusId }: { projectId: string; focusId?: string }) {
  const roles = useSharedRoles();
  if (!roles[projectId]) return <div className="page"><h1>Chat</h1><p className="muted">Chat is for shared projects. Share this project (Overview → Share) to talk with the people you write with.</p></div>;
  return <div className="page chat-page"><ChatPanel projectId={projectId} focusId={focusId} /></div>;
}
