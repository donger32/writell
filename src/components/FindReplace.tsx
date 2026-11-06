import type { Editor } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface Match { from: number; to: number }

function findAll(editor: Editor, term: string, matchCase: boolean, wholeWord: boolean): Match[] {
  if (!term) return [];
  const out: Match[] = [];
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])` : esc, matchCase ? 'gu' : 'giu');
  // search per textblock so matches can span mark boundaries (e.g. part-bold words)
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) for (let i = 0; i < child.text!.length; i++) { text += child.text![i]; map.push(pos + 1 + offset + i); }
      else { text += '￼'; map.push(pos + 1 + offset); }
    });
    for (const m of text.matchAll(re)) {
      if (!m[0].length) continue;
      out.push({ from: map[m.index!], to: map[m.index! + m[0].length - 1] + 1 });
    }
    return false;
  });
  return out;
}

export function FindReplace({ editor, mode, onClose, initialTerm }: { editor: Editor; mode: 'find' | 'replace'; onClose: () => void; initialTerm?: string }) {
  const [term, setTerm] = useState(() => { if (initialTerm) return initialTerm; const { from, to } = editor.state.selection; return from !== to ? editor.state.doc.textBetween(from, to) : ''; });
  const [rep, setRep] = useState('');
  const [showRep, setShowRep] = useState(mode === 'replace');
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [idx, setIdx] = useState(0);
  const [ver, setVer] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setShowRep((r) => r || mode === 'replace'); inputRef.current?.focus(); inputRef.current?.select(); }, [mode]);
  useEffect(() => { const f = () => setVer((v) => v + 1); editor.on('update', f); return () => { editor.off('update', f); }; }, [editor]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matches = useMemo(() => findAll(editor, term, matchCase, whole), [editor, term, matchCase, whole, ver]);
  const cur = matches.length ? ((idx % matches.length) + matches.length) % matches.length : -1;

  const select = (i: number) => {
    if (!matches.length) return;
    const n = ((i % matches.length) + matches.length) % matches.length;
    setIdx(n);
    const m = matches[n];
    editor.chain().setTextSelection(m).scrollIntoView().run();
  };
  const replaceOne = () => {
    if (cur < 0) return;
    const m = matches[cur];
    editor.chain().focus().insertContentAt(m, rep).run();
    setTimeout(() => select(cur), 0);
  };
  const replaceAll = () => {
    if (!matches.length) return;
    let tr = editor.state.tr;
    for (const m of [...matches].reverse()) tr = rep ? tr.insertText(rep, m.from, m.to) : tr.delete(m.from, m.to);
    editor.view.dispatch(tr);
  };

  return (
    <div className="findbar" onKeyDown={(e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.target as HTMLElement).dataset.role === 'find') { e.preventDefault(); select(e.shiftKey ? cur - 1 : cur + 1); }
    }}>
      <div className="row gap-s">
        <input ref={inputRef} data-role="find" className="input sm" placeholder="Find" value={term} onChange={(e) => { setTerm(e.target.value); setIdx(0); }} />
        <span className="muted count">{term ? (matches.length ? `${cur + 1}/${matches.length}` : 'No results') : ''}</span>
        <button className="icon-btn sm" title="Previous (Shift+Enter)" onClick={() => select(cur - 1)}><ChevronUp size={14} /></button>
        <button className="icon-btn sm" title="Next (Enter)" onClick={() => select(cur + 1)}><ChevronDown size={14} /></button>
        <button className={'chip' + (matchCase ? ' on' : '')} title="Match case" onClick={() => setMatchCase(!matchCase)}>Aa</button>
        <button className={'chip' + (whole ? ' on' : '')} title="Whole word" onClick={() => setWhole(!whole)}>W</button>
        <button className={'chip' + (showRep ? ' on' : '')} onClick={() => setShowRep(!showRep)}>Replace</button>
        <span className="grow" />
        <button className="icon-btn sm" onClick={onClose}><X size={14} /></button>
      </div>
      {showRep && (
        <div className="row gap-s">
          <input className="input sm" placeholder="Replace with" value={rep} onChange={(e) => setRep(e.target.value)} />
          <button className="btn sm" onClick={replaceOne} disabled={cur < 0}>Replace</button>
          <button className="btn sm" onClick={replaceAll} disabled={!matches.length}>Replace all ({matches.length})</button>
        </div>
      )}
    </div>
  );
}
