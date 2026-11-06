import type { Editor } from '@tiptap/react';
import { useState } from 'react';
import { X, Send, Copy } from 'lucide-react';
import { db, type Scene } from '../db';
import { jsonToText } from '../editor/extensions';
import { AI_SYSTEM, askClaude, type Msg } from '../ai';
import { toast } from './ui';
import { setNav } from '../nav';
import { getSettings } from '../settings';

const ACTIONS: { id: string; label: string; prompt: string; scope: 'scene' | 'selection' | 'chapter' | 'none' }[] = [
  { id: 'feedback', label: 'Feedback on this scene', scope: 'scene', prompt: 'Give feedback on this scene: what works, what could be stronger (pacing, tension, clarity, character), and the single most important fix.' },
  { id: 'dialogue', label: 'Dialogue feedback', scope: 'scene', prompt: 'Review only the dialogue in this scene: does each character sound distinct and true to their profile? Point out stiff, expository or interchangeable lines.' },
  { id: 'consistency', label: 'Check character consistency', scope: 'scene', prompt: 'Compare how characters are described and behave in this scene with their profiles. List any contradictions (appearance, age, personality, history, names).' },
  { id: 'plotholes', label: 'Look for plot holes', scope: 'chapter', prompt: 'Using the chapter summaries and this chapter\'s text, point out plot holes, unexplained motivations, dropped threads or logic gaps. Be specific.' },
  { id: 'grammar', label: 'Grammar & clarity', scope: 'selection', prompt: 'List grammar, punctuation and clarity issues in this text as: original → suggestion (one line each). Do not change the author\'s voice or style choices.' },
  { id: 'summary', label: 'Summarize this chapter', scope: 'chapter', prompt: 'Write a 2–4 sentence summary of this chapter for the author\'s outline. Plain prose, no heading.' },
  { id: 'prompts', label: 'Give me writing prompts', scope: 'none', prompt: 'Give 5 short, varied writing prompts or "what if" questions that could push this story forward, based on the project so far.' },
];

export function AiPanel({ editor, scene, onClose }: { editor: Editor; scene: Scene; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ title: string; text: string; id: string } | null>(null);
  const [chat, setChat] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const hasKey = !!getSettings().aiKey;

  const context = async (scope: string) => {
    const [project, chapter, chars] = await Promise.all([db.projects.get(scene.projectId), db.chapters.get(scene.chapterId), db.entities.where('[projectId+kind]').equals([scene.projectId, 'character']).toArray()]);
    const profiles = chars.slice(0, 30).map((c) => `- ${c.name}${c.fields.age ? `, ${c.fields.age}` : ''}: ${[c.fields.appearance, c.fields.personality, c.fields.backstory].filter(Boolean).join(' | ').slice(0, 400)}`).join('\n');
    let body = '';
    if (scope === 'selection') {
      const { from, to, empty } = editor.state.selection;
      body = empty ? editor.getText({ blockSeparator: '\n\n' }) : editor.state.doc.textBetween(from, to, '\n\n');
    } else if (scope === 'chapter') {
      const chapters = await db.chapters.where('projectId').equals(scene.projectId).sortBy('order');
      const scenes = await db.scenes.where('chapterId').equals(scene.chapterId).sortBy('order');
      body = `Outline:\n${chapters.map((c) => `${c.title}: ${c.summary || '(no summary)'}`).join('\n')}\n\nCurrent chapter "${chapter?.title}":\n${scenes.map((s) => (s.id === scene.id ? editor.getText({ blockSeparator: '\n\n' }) : jsonToText(s.content))).join('\n\n* * *\n\n')}`;
    } else if (scope === 'scene') body = editor.getText({ blockSeparator: '\n\n' });
    else {
      const chapters = await db.chapters.where('projectId').equals(scene.projectId).sortBy('order');
      body = `Outline:\n${chapters.map((c) => `${c.title}: ${c.summary || '(no summary)'}`).join('\n')}\n\nLatest scene:\n${editor.getText({ blockSeparator: '\n\n' }).slice(-3000)}`;
    }
    return `Novel: "${project?.title}". ${project?.description ?? ''}\n\nCharacter profiles:\n${profiles || '(none yet)'}\n\n---\n${body.slice(0, 60000)}`;
  };

  const run = async (a: typeof ACTIONS[number]) => {
    setBusy(true); setOut(null);
    try {
      const text = await askClaude(AI_SYSTEM, [{ role: 'user', content: `${await context(a.scope)}\n\n---\nTask: ${a.prompt}` }]);
      setOut({ title: a.label, text, id: a.id });
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };

  const send = async () => {
    if (!q.trim()) return;
    const next: Msg[] = [...chat, { role: 'user', content: q.trim() }];
    setChat(next); setQ(''); setBusy(true);
    try {
      const first: Msg = { role: 'user', content: `${await context('none')}\n\n---\nI'd like to brainstorm. ${next[0].content}` };
      const reply = await askClaude(AI_SYSTEM + '\nYou are brainstorming with the author: offer options and questions, not decisions.', [first, ...next.slice(1)]);
      setChat([...next, { role: 'assistant', content: reply }]);
    } catch (e) { toast((e as Error).message); setChat(chat); }
    setBusy(false);
  };

  return (
    <div className="drawer ai">
      <div className="drawer-head"><h4>AI assistant</h4><button className="icon-btn sm" onClick={onClose}><X size={14} /></button></div>
      {!hasKey ? (
        <div className="col gap-s"><p className="muted small">Add your Anthropic API key to use these optional tools.</p><button className="btn sm" onClick={() => setNav({ settingsOpen: true, settingsTab: 'ai' })}>Open AI settings</button></div>
      ) : <>
        <p className="muted small">Nothing is sent until you press a button. Suggestions never change your text.</p>
        <div className="col gap-s">{ACTIONS.map((a) => <button key={a.id} className="btn sm ai-action" disabled={busy} onClick={() => run(a)}>{a.label}</button>)}</div>
        {busy && <p className="muted small">Thinking…</p>}
        {out && (
          <div className="ai-out">
            <div className="row"><strong className="grow">{out.title}</strong><button className="icon-btn sm" title="Copy" onClick={() => navigator.clipboard?.writeText(out.text).then(() => toast('Copied'), () => {})}><Copy size={13} /></button></div>
            <div className="ai-text">{out.text}</div>
            {out.id === 'summary' && <button className="btn sm" onClick={async () => { await db.chapters.update(scene.chapterId, { summary: out.text }); toast('Saved as the chapter summary'); }}>Use as chapter summary</button>}
          </div>
        )}
        <h4 className="mt">Brainstorm</h4>
        <div className="ai-chat">
          {chat.map((m, i) => <div key={i} className={'ai-msg ' + m.role}>{m.content}</div>)}
        </div>
        <div className="row gap-s"><textarea className="input" rows={2} value={q} placeholder="What if…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="icon-btn" disabled={busy} onClick={send} title="Send"><Send size={15} /></button></div>
      </>}
    </div>
  );
}
