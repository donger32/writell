import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, Highlighter, Heading1, Heading2, Heading3, List, ListOrdered, Quote, Link2, Undo2, Redo2,
  Code2, PanelRight, X, Search, BookOpenText, Maximize2, Crosshair, AlignVerticalJustifyCenter, Camera, PenLine, MessageSquarePlus, Flag, CircleDashed, Sparkles, GitPullRequestDraft, MessagesSquare,
} from 'lucide-react';
import { ReviewPanel, addComment, toggleFlag } from './ReviewPanel';
import { SprintButton } from './SprintButton';
import { registerFlush } from '../saveRegistry';
import { matches } from '../shortcuts';
import { confirmDialog } from './ui';
import { AiPanel } from './AiPanel';
import { TimelineBox } from './visual/TimelineBox';
import { sharedKey, useSharedRoles } from '../sync/engine';
import { getSchema } from '@tiptap/core';
import * as Y from 'yjs';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { sceneDoc, encodeDoc, FIELD, REMOTE } from '../sync/ydoc';
import { joinLive, Awareness, type LiveStatus } from '../sync/live';
import { unb64 } from '../sync/crypto';
import { useSocial, cachedProfile } from '../social/api';
import { ChatPanel } from './ChatPanel';
import { SharedComments, sharedCommentsKey, locate, type Anchor } from '../editor/sharedComments';
import { getChat, useChat, useUnread, canComment } from '../social/chat';
import { noteEdit, flushEdit } from '../social/activity';
import { takeReveal } from '../social/reveal';
import { unfollow, useFollowing } from '../social/presence';
import { displayName } from './UserName';
import { CoWriters, userColor } from './CoWriters';
import { db, saveSceneContent, takeSnapshot, type Scene, type Status } from '../db';
import { editorExtensions, jsonToMarkdown, markdownToJson } from '../editor/extensions';
import { getSettings, setSettings, useSettings } from '../settings';
import { go, setNav, useNav } from '../nav';
import { fmtNum, fmtReading, textStats } from '../util';
import { promptDialog, STATUS_COLOR, STATUS_LABEL, toast } from './ui';
import { FindReplace } from './FindReplace';
import { HistoryPanel } from './HistoryPanel';
import { SceneStoryLinks } from './story/links';
import { mentionNames, mentionsKey, type MentionName } from '../editor/mentions';
import { CharacterHoverCard, useMentionHover } from './CharacterCard';

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export function EditorPane({ sceneId, secondary, onClose }: { sceneId: string; secondary?: boolean; onClose?: () => void }) {
  const [initial, setInitial] = useState<Scene | null | undefined>(undefined);
  useEffect(() => { let alive = true; db.scenes.get(sceneId).then((s) => alive && setInitial(s ?? null)); return () => { alive = false; }; }, [sceneId]);
  if (initial === undefined) return <div className="pane" />;
  if (initial === null) return <div className="pane empty-state">This scene no longer exists.</div>;
  return <SharedSwitch scene={initial} secondary={secondary} onClose={onClose} />;
}

/** In a shared project the scene opens in live co-writing mode */
function SharedSwitch({ scene, secondary, onClose }: { scene: Scene; secondary?: boolean; onClose?: () => void }) {
  const roles = useSharedRoles();
  const collab = !!roles[scene.projectId] && !!sharedKey(scene.projectId);
  return <PaneInner key={scene.id + (collab ? ':live' : '')} scene={scene} collab={collab} secondary={secondary} onClose={onClose} />;
}

function PaneInner({ scene: scene0, collab, secondary, onClose }: { scene: Scene; collab?: boolean; secondary?: boolean; onClose?: () => void }) {
  // in live mode, start from the newest saved copy (the one we were handed may be older)
  const [scene] = useState(scene0);
  const social = useSocial();
  const me = social.me;
  const co = useMemo(() => {
    if (!collab) return null;
    const key = sharedKey(scene.projectId); if (!key) return null;
    const schema = getSchema(editorExtensions(() => false, () => false, undefined, []));
    const doc = sceneDoc(scene.ystate, scene.content, schema);
    return { doc, awareness: new Awareness(doc), key };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const s = useSettings();
  const nav = useNav();
  const live = useLiveQuery(() => db.scenes.get(scene.id), [scene.id]);
  const chapter = useLiveQuery(() => db.chapters.get(scene.chapterId), [scene.chapterId]);
  const [save, setSave] = useState<SaveState>('saved');
  const [raw, setRaw] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<null | 'details' | 'history' | 'review' | 'ai' | 'chat'>(nav.editing ? 'review' : null);
  const [chatFocus, setChatFocus] = useState<string | undefined>(undefined);
  // shared projects: comments from the chat are underlined in the text
  const chat = useChat(scene.projectId);
  const anchors = useRef<Anchor[]>([]);
  const openChatAt = useRef<(id: string) => void>(() => {});
  openChatAt.current = (id: string) => { setChatFocus(id); setDrawer('chat'); };
  const titleRef = useRef(scene.title);
  const [findTerm, setFindTerm] = useState<string | undefined>(undefined);
  const [findOpen, setFindOpen] = useState<false | 'find' | 'replace'>(false);
  const [stats, setStats] = useState(() => textStats(''));
  const startWords = useRef<number | null>(null);
  // words typed this session / since the last save; deleting and undo never count
  const lastWords = useRef(0); const typedSession = useRef(0); const typedUnsaved = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<null | (() => Promise<void>)>(null);
  const focusRef = useRef(s.focusMode);
  focusRef.current = s.focusMode;
  const trackRef = useRef(nav.tracking);
  trackRef.current = nav.tracking;
  const reading = nav.reading;
  // character names in the text → hover cards
  const chars = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([scene.projectId, 'character']).toArray(), [scene.projectId]);
  const namesRef = useRef<MentionName[]>([]);
  const cardsRef = useRef(s.charCards);
  cardsRef.current = s.charCards;

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p) await p();
  }, []);

  const editor = useEditor({
    extensions: editorExtensions(() => focusRef.current, () => trackRef.current, { names: () => namesRef.current, enabled: () => cardsRef.current },
      co ? [
        Collaboration.configure({ document: co.doc, field: FIELD }),
        CollaborationCaret.configure({ provider: { awareness: co.awareness }, user: { name: me ? (me.display_name || me.username) : 'Someone', color: userColor(me?.id ?? 'x'), id: me?.id }, render: caret }),
        SharedComments(() => anchors.current, (id) => openChatAt.current(id)),
      ] : undefined),
    content: co ? undefined : (scene.content as object),
    editorProps: { attributes: { spellcheck: String(s.spellcheck), class: 'prose', role: 'textbox', 'aria-multiline': 'true', 'aria-label': `Text of ${scene.title}` } },
    onCreate: ({ editor }) => { const st = textStats(editor.getText({ blockSeparator: '\n\n' })); setStats(st); startWords.current = st.words; lastWords.current = st.words; },
    onUpdate: ({ editor, transaction }) => {
      const st = textStats(editor.getText({ blockSeparator: '\n\n' }));
      setStats(st);
      const grew = st.words - lastWords.current;
      lastWords.current = st.words;
      const fromCoWriter = !!transaction.getMeta(ySyncPluginKey)?.isChangeOrigin;
      if (grew > 0 && !transaction.getMeta('history$') && !fromCoWriter) { typedSession.current += grew; typedUnsaved.current += grew; }
      if (co && grew && !fromCoWriter && transaction.docChanged) noteEdit(scene.projectId, scene.id, titleRef.current, grew);
      setSave('unsaved');
      pending.current = async () => {
        setSave('saving');
        try { const typed = typedUnsaved.current; typedUnsaved.current = 0; await saveSceneContent(scene.id, editor.getJSON(), st.words, typed, co ? encodeDoc(co.doc) : undefined); setSave('saved'); }
        catch (err) { console.error(err); setSave('error'); toast('Could not save! Your text is still in the editor — try exporting a backup.'); }
      };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, getSettings().autosaveDelay);
      if (getSettings().typewriter) centerCaret(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      if (getSettings().typewriter) centerCaret(editor);
      if (focusRef.current) editor.view.dispatch(editor.state.tr.setMeta('focusRefresh', true));
    },
  });

  // live co-writing: join the scene's channel, show who's here
  useEffect(() => {
    if (!co) return;
    const leave = joinLive({ sceneId: scene.id, doc: co.doc, awareness: co.awareness, key: co.key, onStatus: setLiveStatus });
    return () => { leave(); window.setTimeout(() => co.doc.destroy(), 200); };
  }, [co, scene.id]);
  useEffect(() => {
    if (!co || !editor || editor.isDestroyed || !me) return;
    editor.commands.updateUser({ name: me.display_name || me.username, color: userColor(me.id), id: me.id });
  }, [co, editor, me]);
  // report what you wrote to the project chat when you leave the scene
  useEffect(() => () => { if (co) void flushEdit(scene.id); }, [co, scene.id]);
  // comment highlights follow the chat
  const anchorKey = co ? JSON.stringify(chat.msgs.filter((m) => m.kind === 'comment' && !m.resolved && m.body?.sceneId === scene.id).map((m) => [m.id, m.body?.quote, m.body?.before, m.author])) : '';
  useEffect(() => {
    if (!co || !editor || editor.isDestroyed) return;
    anchors.current = (JSON.parse(anchorKey || '[]') as [string, string, string, string][]).map(([id, quote, before, author]) => ({ id, quote, before, color: userColor(author) }));
    editor.view.dispatch(editor.state.tr.setMeta(sharedCommentsKey, true));
  }, [co, editor, anchorKey]);
  // "show in the text" from the chat
  useEffect(() => {
    if (!co || !editor) return;
    const run = () => {
      if (editor.isDestroyed) return;
      const id = takeReveal(scene.id); if (!id) return;
      const m = getChat(scene.projectId).byId.get(id);
      const r = m?.body?.quote ? locate(editor.state.doc, m.body.quote, m.body.before) : null;
      if (!r) { toast('The commented text has changed, so it can’t be found anymore'); return; }
      editor.chain().setTextSelection(r).scrollIntoView().run();
      window.setTimeout(() => { const el = editor.view.dom.querySelector(`[data-scid="${id}"]`); el?.classList.add('flash'); window.setTimeout(() => el?.classList.remove('flash'), 1600); }, 50);
    };
    const t = window.setTimeout(run, 250);
    window.addEventListener('writell:reveal-comment', run);
    return () => { window.clearTimeout(t); window.removeEventListener('writell:reveal-comment', run); };
  }, [co, editor, scene.id, scene.projectId]);
  // following a co-writer: keep their cursor on screen; typing yourself stops following
  const following = useFollowing();
  const followHere = co && following && following.pid === scene.projectId ? following.u : null;
  useEffect(() => {
    if (!co || !editor || !followHere) return;
    let raf = 0;
    const keep = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const el = editor.view.dom.querySelector(`[data-uid="${CSS.escape(followHere)}"]`) as HTMLElement | null;
        const sc = editor.view.dom.closest('.editor-scroll') as HTMLElement | null;
        if (!el || !sc) return;
        const r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
        if (r.top < b.top + 80 || r.bottom > b.bottom - 80) sc.scrollBy({ top: r.top - (b.top + b.height / 2), behavior: 'smooth' });
      });
    };
    const stop = (e: KeyboardEvent) => { if ((e.key.length === 1 && !e.ctrlKey && !e.metaKey) || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete') unfollow(); };
    co.awareness.on('change', keep); keep();
    editor.view.dom.addEventListener('keydown', stop);
    return () => { cancelAnimationFrame(raf); co.awareness.off('change', keep); editor.view.dom.removeEventListener('keydown', stop); };
  }, [co, editor, followHere]);
  const unread = useUnread(co ? scene.projectId : null);

  // Save on unmount, tab hide, and window close.
  useEffect(() => {
    const vis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', vis);
    const unreg = registerFlush(flush);
    return () => { flush(); unreg(); window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', vis); };
  }, [flush]);

  useEffect(() => { editor?.setEditable(!reading && raw === null, false); }, [editor, reading, raw]);
  const nameKey = chars ? JSON.stringify(chars.map((c) => [c.id, c.name, c.fields.nicknames, c.fields.color])) : '';
  useEffect(() => {
    namesRef.current = chars ? mentionNames(chars) : [];
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(mentionsKey, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, nameKey, s.charCards]);
  const columnRef = useRef<HTMLDivElement>(null);
  const hover = useMentionHover(columnRef, s.charCards && raw === null);
  useEffect(() => { editor?.view.dom.setAttribute('spellcheck', String(s.spellcheck)); }, [editor, s.spellcheck]);
  // viewers and commenters of a shared project read only
  const sharedRoles = useSharedRoles();
  const readOnly = sharedRoles[scene.projectId] === 'viewer' || sharedRoles[scene.projectId] === 'commenter';
  useEffect(() => { if (editor && !editor.isDestroyed) editor.setEditable(!readOnly); }, [editor, readOnly]);
  // another device changed this scene (account sync): show its text if nothing is waiting to be saved here
  useEffect(() => {
    if (!editor) return;
    const onRemote = async (e: Event) => {
      if ((e as CustomEvent).detail !== scene.id) return;
      if (co) {
        // live mode: merge the saved copy into the open document (no jumping, nothing lost)
        const f = await db.scenes.get(scene.id);
        if (f?.ystate) Y.applyUpdate(co.doc, unb64(f.ystate), REMOTE);
        return;
      }
      if (pending.current) return;
      const fresh = await db.scenes.get(scene.id);
      if (!fresh || pending.current || editor.isDestroyed) return;
      if (JSON.stringify(editor.getJSON()) === JSON.stringify(fresh.content)) return;
      const { from } = editor.state.selection;
      editor.commands.setContent(fresh.content as object, { emitUpdate: false });
      try { editor.commands.setTextSelection(Math.min(from, editor.state.doc.content.size)); } catch { /* */ }
      const st = textStats(editor.getText({ blockSeparator: '\n\n' }));
      setStats(st); lastWords.current = st.words;
    };
    window.addEventListener('writell:remote-scene', onRemote);
    return () => window.removeEventListener('writell:remote-scene', onRemote);
  }, [editor, scene.id]);
  useEffect(() => { if (editor) editor.view.dispatch(editor.state.tr.setMeta('focusRefresh', true)); }, [editor, s.focusMode]);

  // pane-scoped keyboard shortcuts
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!paneRef.current?.contains(document.activeElement) && !(document.activeElement === document.body && !secondary)) return;
      const mod = e.ctrlKey || e.metaKey;
      void mod;
      if (matches(e, 'find')) { e.preventDefault(); setFindOpen('find'); }
      if (matches(e, 'replace')) { e.preventDefault(); setFindOpen('replace'); }
      if (matches(e, 'save')) { e.preventDefault(); flush().then(() => toast('Saved')); }
      if (matches(e, 'rawMarkdown')) { e.preventDefault(); toggleRaw(); }
      if (e.key === 'Escape' && findOpen) { setFindOpen(false); editor?.commands.focus(); }
      if (matches(e, 'comment') && editor && live) { e.preventDefault(); addComment(editor, live); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const toggleRaw = async () => {
    if (!editor) return;
    if (raw === null) {
      let marks = false;
      editor.state.doc.descendants((n) => { if (n.marks.some((m) => m.type.name === 'comment' || m.type.name === 'flag')) marks = true; });
      if (marks && !(await confirmDialog('Comments and revision flags will be removed', 'Raw Markdown can\'t hold comment anchors or revision flags, so switching back will remove them from this scene. The current version is kept in revision history.', { ok: 'Continue' }))) return;
      await flush();
      setRaw(jsonToMarkdown(editor.getJSON()));
    } else {
      await takeSnapshot(scene.id, 'before-raw-edit');
      const json = markdownToJson(raw);
      editor.commands.setContent(json, { emitUpdate: true });
      setRaw(null);
      await flush();
    }
  };

  // entering editing mode opens the editing tools; leaving closes them
  const editing = nav.editing;
  useEffect(() => { if (!secondary) setDrawer((d) => (editing ? 'review' : d === 'review' ? null : d)); }, [editing, secondary]);

  const sessionWords = typedSession.current;
  const title = live?.title ?? scene.title;
  titleRef.current = title;
  const commenter = sharedRoles[scene.projectId] === 'commenter' || (readOnly && canComment(scene.projectId));
  const followName = followHere ? displayName(cachedProfile(followHere) ?? social.friends.find((f) => f.id === followHere)) : '';

  return (
    <div className={'pane' + (secondary ? ' secondary' : '')} ref={paneRef}>
      {!reading && (
        <div className="pane-head">
          <div className="crumbs ellipsis">
            <span className="muted">{chapter?.title}</span><span className="muted"> / </span>
            <input className="title-input" value={title} onChange={(e) => db.scenes.update(scene.id, { title: e.target.value })} aria-label="Scene title" />
          </div>
          {co && <CoWriters awareness={co.awareness} status={liveStatus} projectId={scene.projectId} sceneId={scene.id} onChat={() => setDrawer('chat')} />}
          <div className="row gap-s">
            <button className={'icon-btn' + (s.focusMode ? ' on' : '')} title="Focus mode (dim other paragraphs)" onClick={() => setSettings({ focusMode: !s.focusMode })}><Crosshair size={16} /></button>
            <button className={'icon-btn' + (s.typewriter ? ' on' : '')} title="Typewriter mode (keep line centred)" onClick={() => setSettings({ typewriter: !s.typewriter })}><AlignVerticalJustifyCenter size={16} /></button>
            <button className={'icon-btn' + (raw !== null ? ' on' : '')} title="Raw Markdown (Ctrl+Shift+M)" onClick={toggleRaw}><Code2 size={16} /></button>
            <button className="icon-btn" title="Find & replace (Ctrl+F / Ctrl+H)" onClick={() => setFindOpen(findOpen ? false : 'find')}><Search size={16} /></button>
            <button className={'icon-btn' + (editing ? ' on' : '')} title={editing ? 'Back to writing mode (Ctrl+E)' : 'Editing mode: comments, revision flags, analysis (Ctrl+E)'} onClick={() => setNav({ editing: !editing })}><PenLine size={16} /></button>
            {s.aiEnabled && <button className={'icon-btn' + (drawer === 'ai' ? ' on' : '')} title="AI assistant (optional)" onClick={() => setDrawer(drawer === 'ai' ? null : 'ai')}><Sparkles size={16} /></button>}
            {!secondary && <button className="icon-btn" title="Reading mode" onClick={() => setNav({ reading: true })}><BookOpenText size={16} /></button>}
            {!secondary && <button className="icon-btn" title="Full screen (F11 / Esc to exit)" onClick={() => toggleFullscreen()}><Maximize2 size={16} /></button>}
            {co && <button className={'icon-btn chat-btn' + (drawer === 'chat' ? ' on' : '')} title="Project chat: messages, comments and changes" onClick={() => { setChatFocus(undefined); setDrawer(drawer === 'chat' ? null : 'chat'); }}><MessagesSquare size={16} />{unread > 0 && drawer !== 'chat' && <span className="dot-count">{unread > 9 ? '9+' : unread}</span>}</button>}
            <button className={'icon-btn' + (drawer === 'details' ? ' on' : '')} title="Scene details" onClick={() => setDrawer(drawer === 'details' ? null : 'details')}><PanelRight size={16} /></button>
            <button className={'icon-btn' + (drawer === 'history' ? ' on' : '')} title="Revision history" onClick={() => setDrawer(drawer === 'history' ? null : 'history')}><Camera size={16} /></button>
            {onClose && <button className="icon-btn" title="Close split" onClick={() => { flush(); onClose(); }}><X size={16} /></button>}
          </div>
        </div>
      )}
      {!reading && raw === null && editor && readOnly && (
        <div className="toolbar ro-tools" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
          {commenter ? <>
            <button className="tb-btn wide" title="Comment on the selected text (Ctrl+Alt+M)" onClick={() => live && addComment(editor, live)}><MessageSquarePlus size={15} /> Comment</button>
            <span className="muted small">Select some text, then press Comment. Everyone sees it in the chat.</span>
          </> : <span className="muted small">You can read this project and chat with everyone.</span>}
        </div>
      )}
      {followHere && <div className="follow-pill"><Crosshair size={13} /> Following <b>{followName}</b><button className="link" onClick={unfollow}>Stop</button></div>}
      {!reading && raw === null && editor && !readOnly && <Toolbar editor={editor} tools={s.toolbar} extra={editing && live ? (
        <>
          <span className="tb-sep" />
          <button className="tb-btn" title="Comment on selection (Ctrl+Alt+M)" onClick={() => addComment(editor, live)}><MessageSquarePlus size={15} /></button>
          <button className={'tb-btn' + (editor.isActive('flag', { kind: 'revise' }) ? ' on' : '')} title="Flag selection: needs revision" onClick={() => toggleFlag(editor, 'revise')}><Flag size={15} /></button>
          <button className={'tb-btn' + (editor.isActive('flag', { kind: 'unfinished' }) ? ' on' : '')} title="Flag selection: unfinished" onClick={() => toggleFlag(editor, 'unfinished')}><CircleDashed size={15} /></button>
          <span className="tb-sep" />
          <button className={'tb-btn wide' + (nav.tracking ? ' on' : '')} title="Track changes: record edits as suggestions you can accept or reject" aria-pressed={nav.tracking} onClick={() => setNav({ tracking: !nav.tracking })}><GitPullRequestDraft size={15} /> Track changes</button>
          <span className="editing-badge">Editing mode</span>
        </>
      ) : null} />}
      {findOpen && editor && raw === null && <FindReplace key={findTerm ?? ''} initialTerm={findTerm} editor={editor} mode={findOpen} onClose={() => { setFindOpen(false); setFindTerm(undefined); editor.commands.focus(); }} />}

      <div className="pane-body">
        <div className={'editor-scroll' + (s.typewriter ? ' typewriter' : '') + (s.focusMode ? ' focus-mode' : '') + (reading ? ' reading' : '') + (editing && !reading ? ' editing' : '')}>
          {raw !== null ? (
            <textarea className="raw" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={s.spellcheck} autoFocus />
          ) : (
            <>
              <div ref={columnRef} className="editor-column-wrap"><EditorContent editor={editor} className="editor-column" /></div>
              {hover.anchor && <CharacterHoverCard anchor={hover.anchor} projectId={scene.projectId} onEnter={hover.enterCard} onLeave={hover.leaveCard} />}
            </>
          )}
        </div>
        {drawer === 'details' && live && <DetailsDrawer scene={live} onClose={() => setDrawer(null)} />}
        {drawer === 'review' && editor && live && <ReviewPanel editor={editor} scene={live} onClose={() => setDrawer(null)} onFind={(t) => { setFindTerm(t); setFindOpen('find'); }} />}
        {drawer === 'chat' && co && <ChatPanel projectId={scene.projectId} compact focusId={chatFocus} onClose={() => setDrawer(null)} />}
        {drawer === 'ai' && editor && live && <AiPanel editor={editor} scene={live} onClose={() => setDrawer(null)} />}
        {drawer === 'history' && editor && <HistoryPanel sceneId={scene.id} getCurrent={() => editor.getJSON()} onRestore={async (content) => {
          await flush(); await takeSnapshot(scene.id, 'before-restore');
          editor.commands.setContent(content as object, { emitUpdate: true }); await flush(); toast('Version restored (the replaced text was saved to history)');
        }} onSnapshot={async () => { await flush(); await takeSnapshot(scene.id, 'manual'); toast('Snapshot saved'); }} onClose={() => setDrawer(null)} />}
      </div>

      {s.showStatsBar && !reading && (
        <div className="statusbar">
          <span>{fmtNum(stats.words)} {stats.words === 1 ? 'word' : 'words'}</span>
          <span>{fmtNum(stats.chars)} characters</span>
          <span>{fmtNum(stats.sentences)} {stats.sentences === 1 ? 'sentence' : 'sentences'}</span>
          <span>{fmtReading(stats.readingMinutes)} read</span>
          {sessionWords > 0 && <span className="accent" title="Words you've typed since opening this scene. Deleting never counts against you.">+{fmtNum(sessionWords)} this session</span>}
          <span className="grow" />
          {nav.tracking && <button className="tracking-badge" onClick={() => setNav({ tracking: false })} title="Click to stop tracking">● Tracking changes</button>}
          {s.showStats && <SprintButton projectId={scene.projectId} />}
          {raw !== null && <span className="accent">Raw Markdown — switch back to apply</span>}
          <span className={'save ' + save}>{{ saved: 'Saved', saving: 'Saving…', unsaved: 'Editing…', error: 'Save failed' }[save]}</span>
        </div>
      )}
    </div>
  );
}

/** A co-writer's cursor: a colored line with their name (data-uid lets you follow it) */
function caret(user: Record<string, unknown>) {
  const c = document.createElement('span');
  c.classList.add('collaboration-carets__caret');
  c.setAttribute('style', `border-color: ${String(user.color)}`);
  if (user.id) c.dataset.uid = String(user.id);
  const l = document.createElement('div');
  l.classList.add('collaboration-carets__label');
  l.setAttribute('style', `background-color: ${String(user.color)}`);
  l.textContent = String(user.name ?? '');
  c.appendChild(l);
  return c;
}

function centerCaret(editor: Editor) {
  requestAnimationFrame(() => {
    const scroller = editor.view.dom.closest('.editor-scroll') as HTMLElement | null;
    if (!scroller) return;
    try {
      const { top } = editor.view.coordsAtPos(editor.state.selection.head);
      const rect = scroller.getBoundingClientRect();
      scroller.scrollBy({ top: top - (rect.top + rect.height / 2), behavior: 'smooth' });
    } catch { /* position not rendered */ }
  });
}

export function toggleFullscreen() {
  const on = !document.fullscreenElement;
  setNav({ fullscreen: on });
  if (on) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.().catch(() => {});
}

function Toolbar({ editor, tools, extra }: { editor: Editor; tools: string[]; extra?: React.ReactNode }) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    editor.on('transaction', f);
    return () => { editor.off('transaction', f); };
  }, [editor]);
  const c = () => editor.chain().focus();
  const defs: Record<string, { icon: React.ReactNode; title: string; run: () => void; active?: boolean }> = {
    bold: { icon: <Bold size={15} />, title: 'Bold (Ctrl+B, or **text**)', run: () => c().smartToggleMark('bold').run(), active: editor.isActive('bold') },
    italic: { icon: <Italic size={15} />, title: 'Italic (Ctrl+I, or *text*)', run: () => c().smartToggleMark('italic').run(), active: editor.isActive('italic') },
    underline: { icon: <Underline size={15} />, title: 'Underline (Ctrl+U)', run: () => c().smartToggleMark('underline').run(), active: editor.isActive('underline') },
    strike: { icon: <Strikethrough size={15} />, title: 'Strikethrough (Ctrl+Shift+S, or ~~text~~)', run: () => c().smartToggleMark('strike').run(), active: editor.isActive('strike') },
    highlight: { icon: <Highlighter size={15} />, title: 'Highlight (Ctrl+Shift+H, or ==text==)', run: () => c().smartToggleMark('highlight').run(), active: editor.isActive('highlight') },
    h1: { icon: <Heading1 size={15} />, title: 'Heading 1 (# )', run: () => c().toggleHeading({ level: 1 }).run(), active: editor.isActive('heading', { level: 1 }) },
    h2: { icon: <Heading2 size={15} />, title: 'Heading 2 (## )', run: () => c().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading', { level: 2 }) },
    h3: { icon: <Heading3 size={15} />, title: 'Heading 3 (### )', run: () => c().toggleHeading({ level: 3 }).run(), active: editor.isActive('heading', { level: 3 }) },
    bullet: { icon: <List size={15} />, title: 'Bulleted list (- )', run: () => c().toggleBulletList().run(), active: editor.isActive('bulletList') },
    ordered: { icon: <ListOrdered size={15} />, title: 'Numbered list (1. )', run: () => c().toggleOrderedList().run(), active: editor.isActive('orderedList') },
    quote: { icon: <Quote size={15} />, title: 'Blockquote (> )', run: () => c().toggleBlockquote().run(), active: editor.isActive('blockquote') },
    link: { icon: <Link2 size={15} />, title: 'Add / remove link', active: editor.isActive('link'), run: async () => {
      if (editor.isActive('link')) return c().unsetLink().run();
      const url = await promptDialog('Link URL', 'https://', 'Add link');
      if (url) c().extendMarkRange('link').setLink({ href: url }).run();
    } },
    undo: { icon: <Undo2 size={15} />, title: 'Undo (Ctrl+Z)', run: () => c().undo().run() },
    redo: { icon: <Redo2 size={15} />, title: 'Redo (Ctrl+Y / Ctrl+Shift+Z)', run: () => c().redo().run() },
  };
  return (
    <div className="toolbar" onMouseDown={(e) => e.preventDefault()}>
      {tools.map((t, i) => {
        const d = defs[t];
        if (!d) return null;
        const sep = (t === 'h1' || t === 'bullet' || t === 'undo') && i > 0;
        return (
          <span key={t} className="row">
            {sep && <span className="tb-sep" />}
            <button className={'tb-btn' + (d.active ? ' on' : '')} title={d.title} onClick={d.run}>{d.icon}</button>
          </span>
        );
      })}
      {extra}
    </div>
  );
}

function DetailsDrawer({ scene, onClose }: { scene: Scene; onClose: () => void }) {
  const chapter = useLiveQuery(() => db.chapters.get(scene.chapterId), [scene.chapterId]);
  return (
    <div className="drawer">
      <div className="drawer-head"><h4>Scene details</h4><button className="icon-btn sm" onClick={onClose}><X size={14} /></button></div>
      <label className="field"><span>Status</span>
        <div className="seg">
          {(Object.keys(STATUS_LABEL) as Status[]).map((st) => (
            <button key={st} className={scene.status === st ? 'on' : ''} onClick={() => db.scenes.update(scene.id, { status: st })}>
              <span className="status-dot" style={{ background: STATUS_COLOR[st] }} />{STATUS_LABEL[st]}
            </button>
          ))}
        </div>
      </label>
      <SceneStoryLinks projectId={scene.projectId} sceneId={scene.id} />
      <label className="field"><span>Scene summary</span>
        <textarea className="input" rows={4} value={scene.summary} placeholder="What happens in this scene?" onChange={(e) => db.scenes.update(scene.id, { summary: e.target.value })} />
      </label>
      <label className="field"><span>Scene notes</span>
        <textarea className="input" rows={6} value={scene.notes} placeholder="Reminders, research, things to fix…" onChange={(e) => db.scenes.update(scene.id, { notes: e.target.value })} />
      </label>
      {chapter && <>
        <div className="drawer-sep" />
        <h4>{chapter.title}</h4>
        <label className="field"><span>Chapter summary</span>
          <textarea className="input" rows={4} value={chapter.summary} placeholder="Chapter summary" onChange={(e) => db.chapters.update(chapter.id, { summary: e.target.value })} />
        </label>
        <label className="field"><span>Chapter notes</span>
          <textarea className="input" rows={4} value={chapter.notes} onChange={(e) => db.chapters.update(chapter.id, { notes: e.target.value })} />
        </label>
        <div className="field"><span>Chapter on the timeline</span><TimelineBox projectId={chapter.projectId} kind="chapter" id={chapter.id} name={chapter.title} /></div>
        <label className="field"><span>Chapter status</span>
          <select className="input" value={chapter.status} onChange={(e) => db.chapters.update(chapter.id, { status: e.target.value as Status })}>
            {(Object.keys(STATUS_LABEL) as Status[]).map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
          </select>
        </label>
      </>}
      <button className="btn ghost sm" onClick={() => go({ view: 'project', projectId: scene.projectId })}>Open project overview</button>
    </div>
  );
}
