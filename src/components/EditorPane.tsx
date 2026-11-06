import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, Highlighter, Heading1, Heading2, Heading3, List, ListOrdered, Quote, Link2, Undo2, Redo2,
  Code2, PanelRight, X, Search, BookOpenText, Maximize2, Crosshair, AlignVerticalJustifyCenter, Camera, PenLine, MessageSquarePlus, Flag, CircleDashed, Sparkles, GitPullRequestDraft,
} from 'lucide-react';
import { ReviewPanel, addComment, toggleFlag } from './ReviewPanel';
import { SprintButton } from './SprintButton';
import { registerFlush } from '../saveRegistry';
import { matches } from '../shortcuts';
import { confirmDialog } from './ui';
import { AiPanel } from './AiPanel';
import { TimelineBox } from './visual/TimelineBox';
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
  return <PaneInner key={sceneId} scene={initial} secondary={secondary} onClose={onClose} />;
}

function PaneInner({ scene, secondary, onClose }: { scene: Scene; secondary?: boolean; onClose?: () => void }) {
  const s = useSettings();
  const nav = useNav();
  const live = useLiveQuery(() => db.scenes.get(scene.id), [scene.id]);
  const chapter = useLiveQuery(() => db.chapters.get(scene.chapterId), [scene.chapterId]);
  const [save, setSave] = useState<SaveState>('saved');
  const [raw, setRaw] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<null | 'details' | 'history' | 'review' | 'ai'>(nav.editing ? 'review' : null);
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
    extensions: editorExtensions(() => focusRef.current, () => trackRef.current, { names: () => namesRef.current, enabled: () => cardsRef.current }),
    content: scene.content as object,
    editorProps: { attributes: { spellcheck: String(s.spellcheck), class: 'prose', role: 'textbox', 'aria-multiline': 'true', 'aria-label': `Text of ${scene.title}` } },
    onCreate: ({ editor }) => { const st = textStats(editor.getText({ blockSeparator: '\n\n' })); setStats(st); startWords.current = st.words; lastWords.current = st.words; },
    onUpdate: ({ editor, transaction }) => {
      const st = textStats(editor.getText({ blockSeparator: '\n\n' }));
      setStats(st);
      const grew = st.words - lastWords.current;
      lastWords.current = st.words;
      if (grew > 0 && !transaction.getMeta('history$')) { typedSession.current += grew; typedUnsaved.current += grew; }
      setSave('unsaved');
      pending.current = async () => {
        setSave('saving');
        try { const typed = typedUnsaved.current; typedUnsaved.current = 0; await saveSceneContent(scene.id, editor.getJSON(), st.words, typed); setSave('saved'); }
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
  // another device changed this scene (account sync): show its text if nothing is waiting to be saved here
  useEffect(() => {
    if (!editor) return;
    const onRemote = async (e: Event) => {
      if ((e as CustomEvent).detail !== scene.id || pending.current) return;
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

  return (
    <div className={'pane' + (secondary ? ' secondary' : '')} ref={paneRef}>
      {!reading && (
        <div className="pane-head">
          <div className="crumbs ellipsis">
            <span className="muted">{chapter?.title}</span><span className="muted"> / </span>
            <input className="title-input" value={title} onChange={(e) => db.scenes.update(scene.id, { title: e.target.value })} aria-label="Scene title" />
          </div>
          <div className="row gap-s">
            <button className={'icon-btn' + (s.focusMode ? ' on' : '')} title="Focus mode (dim other paragraphs)" onClick={() => setSettings({ focusMode: !s.focusMode })}><Crosshair size={16} /></button>
            <button className={'icon-btn' + (s.typewriter ? ' on' : '')} title="Typewriter mode (keep line centred)" onClick={() => setSettings({ typewriter: !s.typewriter })}><AlignVerticalJustifyCenter size={16} /></button>
            <button className={'icon-btn' + (raw !== null ? ' on' : '')} title="Raw Markdown (Ctrl+Shift+M)" onClick={toggleRaw}><Code2 size={16} /></button>
            <button className="icon-btn" title="Find & replace (Ctrl+F / Ctrl+H)" onClick={() => setFindOpen(findOpen ? false : 'find')}><Search size={16} /></button>
            <button className={'icon-btn' + (editing ? ' on' : '')} title={editing ? 'Back to writing mode (Ctrl+E)' : 'Editing mode: comments, revision flags, analysis (Ctrl+E)'} onClick={() => setNav({ editing: !editing })}><PenLine size={16} /></button>
            {s.aiEnabled && <button className={'icon-btn' + (drawer === 'ai' ? ' on' : '')} title="AI assistant (optional)" onClick={() => setDrawer(drawer === 'ai' ? null : 'ai')}><Sparkles size={16} /></button>}
            {!secondary && <button className="icon-btn" title="Reading mode" onClick={() => setNav({ reading: true })}><BookOpenText size={16} /></button>}
            {!secondary && <button className="icon-btn" title="Full screen (F11 / Esc to exit)" onClick={() => toggleFullscreen()}><Maximize2 size={16} /></button>}
            <button className={'icon-btn' + (drawer === 'details' ? ' on' : '')} title="Scene details" onClick={() => setDrawer(drawer === 'details' ? null : 'details')}><PanelRight size={16} /></button>
            <button className={'icon-btn' + (drawer === 'history' ? ' on' : '')} title="Revision history" onClick={() => setDrawer(drawer === 'history' ? null : 'history')}><Camera size={16} /></button>
            {onClose && <button className="icon-btn" title="Close split" onClick={() => { flush(); onClose(); }}><X size={16} /></button>}
          </div>
        </div>
      )}
      {!reading && raw === null && editor && <Toolbar editor={editor} tools={s.toolbar} extra={editing && live ? (
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
