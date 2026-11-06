import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Search, FileText, BookOpen, User, Globe, StickyNote, Link2 } from 'lucide-react';
import { db } from '../../db';
import { sceneText } from '../../editor/extensions';
import { go } from '../../nav';
import { openEntity } from './links';

type Cat = 'scenes' | 'chapters' | 'characters' | 'world' | 'notes' | 'relationships';
const CATS: { id: Cat; label: string; icon: typeof Search }[] = [
  { id: 'scenes', label: 'Scene text', icon: FileText }, { id: 'chapters', label: 'Chapters', icon: BookOpen },
  { id: 'characters', label: 'Characters', icon: User }, { id: 'world', label: 'World & places', icon: Globe },
  { id: 'notes', label: 'Notes', icon: StickyNote }, { id: 'relationships', label: 'Relationships', icon: Link2 },
];

interface Hit { cat: Cat; title: string; snippet: string; count: number; open: () => void }

function snippets(text: string, needle: string, max = 2) {
  const out: string[] = [];
  const low = text.toLowerCase();
  let i = low.indexOf(needle), count = 0;
  while (i >= 0) {
    count++;
    if (out.length < max) out.push((i > 50 ? '…' : '') + text.slice(Math.max(0, i - 50), i + needle.length + 70).replace(/\s+/g, ' ') + '…');
    i = low.indexOf(needle, i + needle.length);
  }
  return { out, count };
}

export function SearchView({ projectId, q: initialQ }: { projectId: string; q?: string }) {
  const [q, setQ] = useState(initialQ ?? '');
  const [cats, setCats] = useState<Set<Cat>>(new Set(CATS.map((c) => c.id)));
  const data = useLiveQuery(async () => {
    const [chapters, scenes, entities, links] = await Promise.all([
      db.chapters.where('projectId').equals(projectId).sortBy('order'), db.scenes.where('projectId').equals(projectId).toArray(),
      db.entities.where('projectId').equals(projectId).toArray(), db.links.where('projectId').equals(projectId).toArray(),
    ]);
    return { chapters, scenes: scenes.map((s) => ({ s, text: sceneText(s) })), entities, links };
  }, [projectId]);

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!data || needle.length < 2) return [];
    const res: Hit[] = [];
    const chMap = new Map(data.chapters.map((c) => [c.id, c]));
    const order = new Map(data.chapters.map((c, i) => [c.id, i]));
    for (const { s, text } of [...data.scenes].sort((a, b) => (order.get(a.s.chapterId)! - order.get(b.s.chapterId)!) || a.s.order - b.s.order)) {
      const full = `${s.title}\n${s.summary}\n${s.notes}\n${text}`;
      const { out, count } = snippets(full, needle);
      if (count) res.push({ cat: 'scenes', title: `${chMap.get(s.chapterId)?.title} · ${s.title}`, snippet: out.join('   '), count, open: () => go({ view: 'write', projectId, sceneId: s.id }) });
    }
    for (const c of data.chapters) {
      const { out, count } = snippets(`${c.title}\n${c.summary}\n${c.notes}`, needle);
      if (count) res.push({ cat: 'chapters', title: c.title, snippet: out.join('   '), count, open: () => go({ view: 'project', projectId }) });
    }
    for (const e of data.entities) {
      const custom = (e.fields.custom as { label: string; value: string }[] | undefined)?.map((c) => `${c.label}: ${c.value}`).join('\n') ?? '';
      const body = Object.entries(e.fields).filter(([k, v]) => typeof v === 'string' && k !== 'image' && !(v as string).startsWith('data:')).map(([, v]) => v).join('\n');
      const { out, count } = snippets(`${e.name}\n${e.tags.map((t) => '#' + t).join(' ')}\n${body}\n${custom}`, needle);
      const cat: Cat = e.kind === 'character' ? 'characters' : e.kind === 'world' ? 'world' : 'notes';
      if (count) res.push({ cat, title: e.name || 'Untitled', snippet: out.join('   '), count, open: () => openEntity(e) });
    }
    const byId = new Map(data.entities.map((e) => [e.id, e]));
    for (const l of data.links) {
      const label = [l.data.label, l.data.reverseLabel].filter(Boolean).join(' / ');
      if (!label.toLowerCase().includes(needle)) continue;
      const a = byId.get(l.fromId), b = byId.get(l.toId);
      if (a && b) res.push({ cat: 'relationships', title: `${a.name} ↔ ${b.name}`, snippet: label, count: 1, open: () => openEntity(a) });
    }
    return res;
  }, [data, q, projectId]);

  const counts = new Map<Cat, number>();
  hits.forEach((h) => counts.set(h.cat, (counts.get(h.cat) ?? 0) + 1));
  const shown = hits.filter((h) => cats.has(h.cat));
  const needle = q.trim();

  return (
    <div className="page">
      <h1>Search this project</h1>
      <div className="bigsearch"><Search size={16} /><input autoFocus placeholder="Search everything in this project…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="filter-chips">
        {CATS.map((c) => (
          <button key={c.id} className={'chip' + (cats.has(c.id) ? ' on' : '')} onClick={() => setCats((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>
            <c.icon size={11} /> {c.label}{needle.length >= 2 ? ` ${counts.get(c.id) ?? 0}` : ''}
          </button>
        ))}
      </div>
      <div className="results">
        {needle.length >= 2 && !shown.length && <p className="muted">No results for “{needle}”.</p>}
        {shown.map((h, i) => {
          const C = CATS.find((c) => c.id === h.cat)!;
          return (
            <button key={i} className="result" onClick={h.open}>
              <div className="row gap-s"><C.icon size={14} className="muted" /><strong className="grow ellipsis">{h.title}</strong>{h.count > 1 && <span className="muted small">{h.count} matches</span>}</div>
              <div className="result-snip">{highlight(h.snippet, needle)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function highlight(text: string, needle: string) {
  if (!needle) return text;
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((p, i) => (p.toLowerCase() === needle.toLowerCase() ? <mark key={i}>{p}</mark> : p));
}
