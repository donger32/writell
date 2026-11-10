import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Search, FileText, BookOpen, User, Globe, StickyNote, Link2 } from 'lucide-react';
import { db } from '../../db';
import { sceneText } from '../../editor/extensions';
import { go } from '../../nav';
import { openEntity } from './links';

type Cat = 'scenes' | 'chapters' | 'characters' | 'world' | 'notes' | 'other';
const CATS: { id: Cat; label: string; icon: typeof Search }[] = [
  { id: 'scenes', label: 'Scenes', icon: FileText }, { id: 'chapters', label: 'Chapters', icon: BookOpen },
  { id: 'characters', label: 'Characters', icon: User }, { id: 'world', label: 'Places & world', icon: Globe },
  { id: 'notes', label: 'Notes', icon: StickyNote }, { id: 'other', label: 'Maps & more', icon: Link2 },
];
const KIND_LABEL: Record<string, string> = { term: 'Glossary', map: 'Map', familytree: 'Tree', relmap: 'Relation map', timeline: 'Timeline', event: 'Timeline event', task: 'Task' };

interface Hit { cat: Cat; title: string; sub?: string; snippet: string; where?: string; count: number; open: () => void }

/** readable text only: skip pictures, files and stored data (long runs without spaces) */
const readable = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && !v.startsWith('data:') && !/\S{80,}/.test(v);
const nice = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase());

function find(parts: { where?: string; text: string }[], needle: string) {
  let count = 0; let first: { where?: string; snip: string } | null = null;
  for (const p of parts) {
    const low = p.text.toLowerCase();
    let i = low.indexOf(needle);
    while (i >= 0) {
      count++;
      if (!first) first = { where: p.where, snip: (i > 50 ? '…' : '') + p.text.slice(Math.max(0, i - 50), i + needle.length + 80).replace(/\s+/g, ' ') + (i + needle.length + 80 < p.text.length ? '…' : '') };
      i = low.indexOf(needle, i + needle.length);
    }
  }
  return { count, first };
}

export function SearchView({ projectId, q: initialQ }: { projectId: string; q?: string }) {
  const [q, setQ] = useState(initialQ ?? '');
  const [tab, setTab] = useState<Cat | 'all'>('all');
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
    const add = (cat: Cat, title: string, sub: string | undefined, parts: { where?: string; text: string }[], open: () => void) => {
      const { count, first } = find(parts.filter((p) => readable(p.text)), needle);
      if (count && first) res.push({ cat, title, sub, snippet: first.snip, where: first.where, count, open });
    };
    for (const { s, text } of [...data.scenes].sort((a, b) => ((order.get(a.s.chapterId) ?? 1e9) - (order.get(b.s.chapterId) ?? 1e9)) || a.s.order - b.s.order)) {
      add('scenes', s.title || 'Untitled scene', chMap.get(s.chapterId)?.title, [{ where: 'Title', text: s.title }, { where: 'Summary', text: s.summary }, { where: 'Notes', text: s.notes }, { text }], () => go({ view: 'write', projectId, sceneId: s.id }));
    }
    for (const c of data.chapters) add('chapters', c.title, undefined, [{ where: 'Title', text: c.title }, { where: 'Summary', text: c.summary }, { where: 'Notes', text: c.notes }], () => go({ view: 'project', projectId }));
    for (const e of data.entities) {
      const cat: Cat = e.kind === 'character' ? 'characters' : e.kind === 'world' ? 'world' : e.kind === 'note' ? 'notes' : 'other';
      // maps, trees and timelines hold drawings and positions, not text: only their name counts
      const textual = e.kind === 'character' || e.kind === 'world' || e.kind === 'note' || e.kind === 'event' || e.kind === 'task' || e.kind === 'term';
      const custom = (e.fields.custom as { label: string; value: string }[] | undefined) ?? [];
      const parts = [
        { where: 'Name', text: e.name }, { where: 'Tags', text: e.tags.map((t) => '#' + t).join(' ') },
        ...(textual ? Object.entries(e.fields).filter(([k]) => !['image', 'images', 'color', 'custom'].includes(k)).map(([k, v]) => ({ where: nice(k), text: String(readable(v) ? v : '') })) : []),
        ...custom.map((c) => ({ where: c.label, text: String(c.value ?? '') })),
      ];
      const sub = e.kind === 'character' ? String(e.fields.role ?? '') : e.kind === 'world' ? String(e.fields.category ?? '') : e.kind === 'note' ? String(e.fields.type ?? 'Note') : KIND_LABEL[e.kind] ?? '';
      add(cat, e.name || 'Untitled', sub, parts, () => openEntity(e));
    }
    const byId = new Map(data.entities.map((e) => [e.id, e]));
    for (const l of data.links) {
      const label = [l.data.label, l.data.reverseLabel].filter((x) => typeof x === 'string' && x).join(' / ');
      if (!label.toLowerCase().includes(needle)) continue;
      const a = byId.get(l.fromId), b = byId.get(l.toId);
      if (a && b) res.push({ cat: 'other', title: `${a.name} ↔ ${b.name}`, sub: 'Relationship', snippet: label, count: 1, open: () => openEntity(a) });
    }
    return res;
  }, [data, q, projectId]);

  const counts = new Map<Cat, number>();
  hits.forEach((h) => counts.set(h.cat, (counts.get(h.cat) ?? 0) + 1));
  const needle = q.trim();
  const active = tab !== 'all' && !counts.get(tab) ? 'all' : tab;
  const groups = CATS.filter((c) => (active === 'all' || c.id === active) && counts.get(c.id));

  return (
    <div className="page search-page">
      <h1>Search this project</h1>
      <div className="bigsearch"><Search size={16} /><input autoFocus placeholder="Characters, places, notes, words in your scenes…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {needle.length >= 2 && hits.length > 0 && (
        <div className="seg search-tabs" role="tablist">
          <button role="tab" aria-selected={active === 'all'} className={active === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All <span className="seg-count">{hits.length}</span></button>
          {CATS.filter((c) => counts.get(c.id)).map((c) => (
            <button key={c.id} role="tab" aria-selected={active === c.id} className={active === c.id ? 'on' : ''} onClick={() => setTab(c.id)}><c.icon size={12} /> {c.label} <span className="seg-count">{counts.get(c.id)}</span></button>
          ))}
        </div>
      )}
      <div className="results">
        {needle.length < 2 && <p className="muted">Type at least 2 letters to search your scenes, chapters, characters, places and notes.</p>}
        {needle.length >= 2 && !hits.length && <p className="muted">Nothing found for “{needle}”.</p>}
        {groups.map((g) => (
          <section key={g.id} className="result-group">
            {active === 'all' && <h3 className="result-head"><g.icon size={13} /> {g.label} <span className="muted">{counts.get(g.id)}</span></h3>}
            {hits.filter((h) => h.cat === g.id).map((h, i) => (
              <button key={i} className="result" onClick={h.open}>
                <div className="row gap-s"><strong className="ellipsis">{highlight(h.title, needle)}</strong>{h.sub && <span className="muted small ellipsis">{h.sub}</span>}<span className="grow" />{h.count > 1 && <span className="muted small">{h.count} matches</span>}</div>
                {h.where !== 'Name' && h.where !== 'Title' && <div className="result-snip">{h.where && <span className="result-where">{h.where}: </span>}{highlight(h.snippet, needle)}</div>}
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function highlight(text: string, needle: string) {
  if (!needle) return text;
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((p, i) => (p.toLowerCase() === needle.toLowerCase() ? <mark key={i}>{p}</mark> : p));
}
