import type { Editor } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { X, Check, MessageSquare, Trash2, Flag, Plus, RotateCcw } from 'lucide-react';
import { db, uid, type Entity, type Scene } from '../db';
import { createEntity, deleteEntity, updateEntity } from '../entities';
import { findMarkRanges, removeMarkById } from '../editor/reviewMarks';
import { sceneText } from '../editor/extensions';
import { listChanges, resolveAll, resolveChange } from '../editor/trackChanges';
import { setNav, useNav } from '../nav';
import { DEFAULT_CHECKLIST, adverbs, echoes, nameInconsistencies, repeatedPhrases, repeatedWords } from '../analysis';
import { go } from '../nav';
import { Check as CheckIcon, X as XIcon } from 'lucide-react';
import { timeAgo } from '../util';
import { promptDialog, toast } from './ui';

type Tab = 'comments' | 'changes' | 'analysis' | 'checklist';

export interface Reply { id: string; text: string; at: number }

/** Add a comment to the current selection */
export async function addComment(editor: Editor, scene: Scene) {
  const { from, to, empty } = editor.state.selection;
  if (empty) { toast('Select the text you want to comment on first'); return; }
  const quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 200);
  const text = await promptDialog('Comment', '', 'Add comment');
  if (!text) return;
  const id = await createEntity(scene.projectId, 'comment', quote, { sceneId: scene.id, text, resolved: false, replies: [] });
  editor.chain().focus().setTextSelection({ from, to }).setMark('comment', { id }).run();
}

export function toggleFlag(editor: Editor, kind: 'revise' | 'unfinished') {
  const { from, to, empty } = editor.state.selection;
  if (empty) { toast('Select the text to flag first'); return; }
  if (editor.isActive('flag', { kind })) editor.chain().focus().unsetMark('flag').run();
  else editor.chain().focus().setTextSelection({ from, to }).setMark('flag', { kind }).run();
}

export function ReviewPanel({ editor, scene, onClose, onFind }: { editor: Editor; scene: Scene; onClose: () => void; onFind: (term: string) => void }) {
  const [tab, setTab] = useState<Tab>('comments');
  return (
    <div className="drawer review">
      <div className="drawer-head"><h4>Editing tools</h4><button className="icon-btn sm" onClick={onClose}><X size={14} /></button></div>
      <div className="seg full">
        <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>Comments</button>
        <button className={tab === 'changes' ? 'on' : ''} onClick={() => setTab('changes')}>Changes</button>
        <button className={tab === 'analysis' ? 'on' : ''} onClick={() => setTab('analysis')}>Analysis</button>
        <button className={tab === 'checklist' ? 'on' : ''} onClick={() => setTab('checklist')}>Checklist</button>
      </div>
      {tab === 'comments' && <Comments editor={editor} scene={scene} />}
      {tab === 'changes' && <Changes editor={editor} />}
      {tab === 'analysis' && <Analysis editor={editor} scene={scene} onFind={onFind} />}
      {tab === 'checklist' && <Checklist scene={scene} />}
    </div>
  );
}

function Comments({ editor, scene }: { editor: Editor; scene: Scene }) {
  const comments = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([scene.projectId, 'comment']).filter((c) => c.fields.sceneId === scene.id).sortBy('createdAt'), [scene.id]);
  const [showResolved, setShowResolved] = useState(false);
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); editor.on('update', f); return () => { editor.off('update', f); }; }, [editor]);
  const flags = findMarkRanges(editor, 'flag', () => true);
  if (!comments) return null;
  const select = (from: number, to: number) => editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
  const shown = comments.filter((c) => showResolved || !c.fields.resolved);

  return (
    <div className="col gap-s">
      <div className="row gap-s">
        <button className="btn sm" onClick={() => addComment(editor, scene)}><MessageSquare size={13} /> Comment on selection</button>
        <label className="check small"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Resolved</label>
      </div>
      {!shown.length && <p className="muted small">No {showResolved ? '' : 'open '}comments. Select text, then press the comment button (or Ctrl+Alt+M).</p>}
      {shown.map((c) => <CommentCard key={c.id} c={c} editor={editor} select={select} />)}

      <h4 className="mt">Flagged passages</h4>
      {!flags.length && <p className="muted small">Select text and use “Needs revision” or “Unfinished” in the toolbar to flag it.</p>}
      {flags.map((f, i) => (
        <button key={i} className={'flag-row ' + String(f.attrs.kind)} onClick={() => select(f.from, f.to)}>
          <Flag size={12} /><span className="grow ellipsis">“{f.text}”</span><span className="muted small">{f.attrs.kind === 'unfinished' ? 'Unfinished' : 'Revise'}</span>
        </button>
      ))}
    </div>
  );
}

function CommentCard({ c, editor, select }: { c: Entity; editor: Editor; select: (a: number, b: number) => void }) {
  const [reply, setReply] = useState('');
  const replies = (c.fields.replies as Reply[]) ?? [];
  const range = findMarkRanges(editor, 'comment', (a) => a.id === c.id)[0];
  return (
    <div className={'comment' + (c.fields.resolved ? ' resolved' : '')}>
      <button className="comment-quote" onClick={() => range && select(range.from, range.to)} title={range ? 'Show in text' : 'The commented text was deleted'}>“{range?.text ?? c.name}”{!range && <em className="muted"> (text removed)</em>}</button>
      <p>{String(c.fields.text)}</p>
      <span className="muted small">You · {timeAgo(c.createdAt)}</span>
      {replies.map((r) => <div key={r.id} className="reply"><p>{r.text}</p><span className="muted small">You · {timeAgo(r.at)}</span></div>)}
      <div className="row gap-s">
        <input className="input sm grow" placeholder="Reply…" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Enter' && reply.trim()) { updateEntity(c.id, { fields: { replies: [...replies, { id: uid(), text: reply.trim(), at: Date.now() }] } }); setReply(''); }
        }} />
        <button className="icon-btn sm" title={c.fields.resolved ? 'Reopen' : 'Resolve'} onClick={() => updateEntity(c.id, { fields: { resolved: !c.fields.resolved } })}>{c.fields.resolved ? <RotateCcw size={13} /> : <Check size={13} />}</button>
        <button className="icon-btn sm" title="Delete comment" onClick={async () => { removeMarkById(editor, 'comment', c.id); await deleteEntity(c.id); }}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

function Analysis({ editor, scene, onFind }: { editor: Editor; scene: Scene; onFind: (t: string) => void }) {
  const [scope, setScope] = useState<'scene' | 'chapter' | 'project'>('scene');
  const [ver, setVer] = useState(0);
  useEffect(() => { const t = setInterval(() => setVer((v) => v + 1), 4000); return () => clearInterval(t); }, []);
  const data = useLiveQuery(async () => {
    const scenes = scope === 'scene' ? [] : scope === 'chapter' ? await db.scenes.where('chapterId').equals(scene.chapterId).toArray() : await db.scenes.where('projectId').equals(scene.projectId).toArray();
    const chars = await db.entities.where('[projectId+kind]').equals([scene.projectId, 'character']).toArray();
    const threads = await db.entities.where('[projectId+kind]').equals([scene.projectId, 'note']).filter((n) => n.fields.type === 'Plot thread' && !n.fields.resolved).toArray();
    return { others: scenes.filter((s) => s.id !== scene.id).map((s) => sceneText(s)).join('\n\n'), names: chars.flatMap((c) => [c.name, String(c.fields.nicknames ?? '')]), threads };
  }, [scope, scene.id]);
  const text = useMemo(() => editor.getText({ blockSeparator: '\n\n' }) + (data?.others ? '\n\n' + data.others : ''), [editor, data, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = useMemo(() => data && ({ words: repeatedWords(text), phrases: repeatedPhrases(text), echo: echoes(text), ly: adverbs(text), names: nameInconsistencies(text, data.names) }), [text, data]);
  if (!res || !data) return null;
  const list = (items: [string, number][], empty: string) => items.length ? (
    <div className="chips">{items.map(([w, n]) => <button key={w} className="count-chip" onClick={() => onFind(w)} title="Find in this scene">{w} <b>{n}</b></button>)}</div>
  ) : <p className="muted small">{empty}</p>;
  return (
    <div className="col gap-s analysis">
      <div className="seg">{(['scene', 'chapter', 'project'] as const).map((s) => <button key={s} className={scope === s ? 'on' : ''} onClick={() => setScope(s)}>This {s}</button>)}</div>
      <h4>Possible name typos</h4>
      {res.names.length ? res.names.map((n) => <button key={n.found} className="flag-row" onClick={() => onFind(n.found)}><span className="grow">“{n.found}” ×{n.count}</span><span className="muted small">did you mean {n.probably}?</span></button>)
        : <p className="muted small">No near-misses of your characters' names found.</p>}
      <h4>Most repeated words</h4>{list(res.words, 'Nothing repeated yet.')}
      <h4>Repeated phrases</h4>{list(res.phrases, 'No repeated phrases.')}
      <h4>Echoes <span className="muted small">(same word close together)</span></h4>{list(res.echo, 'No close repetitions.')}
      <h4>-ly adverbs</h4>{list(res.ly.slice(0, 20), 'None found.')}
      <h4>Unresolved plot threads</h4>
      {data.threads.length ? data.threads.map((t) => <button key={t.id} className="flag-row" onClick={() => go({ view: 'notes', projectId: scene.projectId, entityId: t.id })}><span className="grow ellipsis">{t.name || 'Untitled thread'}</span></button>)
        : <p className="muted small">None open. Create a note of type “Plot thread” to track one.</p>}
    </div>
  );
}

function Checklist({ scene }: { scene: Scene }) {
  const chapter = useLiveQuery(() => db.chapters.get(scene.chapterId), [scene.chapterId]);
  const project = useLiveQuery(() => db.projects.get(scene.projectId), [scene.projectId]);
  if (!chapter || !project) return null;
  const items = chapter.checklist ?? [];
  const save = (c: typeof items) => db.chapters.update(chapter.id, { checklist: c });
  const done = items.filter((i) => i.done).length;
  return (
    <div className="col gap-s">
      <p className="muted small">Editing checklist for <strong>{chapter.title}</strong>{items.length ? ` · ${done}/${items.length} done` : ''}</p>
      {!items.length && <button className="btn sm" onClick={() => save((project.checklistTemplate ?? DEFAULT_CHECKLIST).map((text) => ({ id: uid(), text, done: false })))}>Start from the standard checklist</button>}
      {items.map((it) => (
        <div key={it.id} className="row gap-s check-item">
          <input type="checkbox" checked={it.done} onChange={(e) => save(items.map((x) => (x.id === it.id ? { ...x, done: e.target.checked } : x)))} />
          <span className={'grow' + (it.done ? ' done' : '')}>{it.text}</span>
          <button className="icon-btn sm" onClick={() => save(items.filter((x) => x.id !== it.id))}><X size={12} /></button>
        </div>
      ))}
      <div className="row gap-s">
        <button className="btn ghost sm" onClick={async () => { const t = await promptDialog('Checklist item', '', 'Add'); if (t) save([...items, { id: uid(), text: t, done: false }]); }}><Plus size={13} /> Add item</button>
        {items.length > 0 && <button className="btn ghost sm" onClick={async () => { await db.projects.update(project.id, { checklistTemplate: items.map((i) => i.text) }); toast('Saved as the default for new chapters'); }}>Use as default</button>}
      </div>
    </div>
  );
}

function Changes({ editor }: { editor: Editor }) {
  const { tracking } = useNav();
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); editor.on('update', f); return () => { editor.off('update', f); }; }, [editor]);
  const changes = listChanges(editor);
  const select = (from: number, to: number) => editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
  return (
    <div className="col gap-s">
      <label className="check"><input type="checkbox" checked={tracking} onChange={(e) => setNav({ tracking: e.target.checked })} /> Track my changes</label>
      <p className="muted small">While on, new text is underlined in green and deleted text stays visible, struck through in red, until you accept or reject it. Exports, word counts and search ignore suggested deletions. Splitting or joining paragraphs is applied directly.</p>
      {changes.length > 0 && (
        <div className="row gap-s">
          <button className="btn sm" onClick={() => { const n = resolveAll(editor, true); toast(`Accepted ${n} change${n === 1 ? '' : 's'}`); }}><CheckIcon size={13} /> Accept all</button>
          <button className="btn ghost sm" onClick={() => { const n = resolveAll(editor, false); toast(`Rejected ${n} change${n === 1 ? '' : 's'}`); }}><XIcon size={13} /> Reject all</button>
        </div>
      )}
      {!changes.length && <p className="muted small">No suggested changes in this scene.</p>}
      {changes.map((c, i) => (
        <div key={i} className={'change ' + c.kind}>
          <button className="change-text" onClick={() => select(c.from, c.to)}>
            <span className="muted small">{c.kind === 'insertion' ? 'Added' : 'Deleted'} · {timeAgo(c.at || Date.now())}</span>
            <span className={c.kind === 'insertion' ? 'tc-ins' : 'tc-del'}>{c.text.length > 140 ? c.text.slice(0, 140) + '…' : c.text}</span>
          </button>
          <div className="row gap-s">
            <button className="icon-btn sm" title="Accept" aria-label="Accept change" onClick={() => resolveChange(editor, c, true)}><CheckIcon size={13} /></button>
            <button className="icon-btn sm" title="Reject" aria-label="Reject change" onClick={() => resolveChange(editor, c, false)}><XIcon size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
