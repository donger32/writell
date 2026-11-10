/*
 * Glossary: words made up for the story's world, with what they mean.
 * They're underlined in the writing; pointing at one shows its meaning.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { BookA, Plus, Search, Trash2 } from 'lucide-react';
import { db } from '../../db';
import { createEntity, deleteEntity, updateEntity } from '../../entities';
import { toastTrashed } from '../TrashView';
import { Field } from './common';

export function GlossaryView({ projectId, entityId }: { projectId: string; entityId?: string }) {
  const terms = useLiveQuery(() => db.entities.where('[projectId+kind]').equals([projectId, 'term']).toArray(), [projectId]);
  const [q, setQ] = useState('');
  const [word, setWord] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  // open on a word (from the hover card in the editor): scroll to it
  useEffect(() => {
    if (!entityId || !terms) return;
    setQ('');
    window.setTimeout(() => document.getElementById('term-' + entityId)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
  }, [entityId, !!terms]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = (terms ?? [])
      .filter((e) => !t || [e.name, e.fields.aliases, e.fields.definition, e.fields.category].some((v) => String(v ?? '').toLowerCase().includes(t)))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    const g = new Map<string, typeof list>();
    for (const e of list) { const L = (e.name.trim()[0] ?? '#').toUpperCase(); const k = /\p{L}/u.test(L) ? L : '#'; g.set(k, [...(g.get(k) ?? []), e]); }
    return [...g.entries()];
  }, [terms, q]);
  if (!terms) return null;
  const add = async () => {
    const n = word.trim(); if (!n) return;
    const id = await createEntity(projectId, 'term', n, { definition: '', aliases: '' });
    setWord(''); setFresh(id);
    window.setTimeout(() => (document.querySelector(`#term-${id} .term-def textarea`) as HTMLTextAreaElement | null)?.focus(), 80);
  };
  return (
    <div className="page glossary-page">
      <header className="page-head">
        <div>
          <h1>Glossary</h1>
          <p className="muted">Words made up for your world (places, titles, foods, spells, slang) and what they mean. They're underlined in your writing; point at one to see its meaning.</p>
        </div>
      </header>
      <form className="task-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <BookA size={16} className="muted" />
        <input className="input" value={word} onChange={(e) => setWord(e.target.value)} placeholder="Add a word and press Enter, e.g. Kaer" aria-label="New word" />
        <button className="btn primary sm" disabled={!word.trim()}><Plus size={13} /> Add</button>
      </form>
      {terms.length > 6 && (
        <label className="glossary-search"><Search size={14} className="muted" /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a word or meaning…" aria-label="Find in glossary" /></label>
      )}
      {!terms.length && <p className="muted empty-hint">No words yet. Add the first one above.</p>}
      {terms.length > 0 && !groups.length && <p className="muted empty-hint">Nothing matches “{q}”.</p>}
      {groups.map(([letter, list]) => (
        <section key={letter} className="glossary-group">
          <h2 className="glossary-letter">{letter}</h2>
          {list.map((t) => (
            <article key={t.id} id={'term-' + t.id} className={'term-card-row' + (t.id === entityId || t.id === fresh ? ' hl' : '')}>
              <div className="row gap-s">
                <Field wrap className="term-name grow" value={t.name} onCommit={(v) => updateEntity(t.id, { name: v.trim() || t.name })} />
                <button className="icon-btn sm" title="Delete word" aria-label={`Delete ${t.name}`} onClick={async () => toastTrashed(t.name, await deleteEntity(t.id))}><Trash2 size={14} /></button>
              </div>
              <div className="row gap-s wrap term-meta">
                <input className="input sm" defaultValue={String(t.fields.aliases ?? '')} key={'a' + String(t.fields.aliases ?? '')} placeholder="Also written as (e.g. Kaers, kaer)" aria-label="Also written as"
                  onBlur={(e) => { if (e.target.value !== String(t.fields.aliases ?? '')) updateEntity(t.id, { fields: { aliases: e.target.value } }); }} />
                <input className="input sm" defaultValue={String(t.fields.category ?? '')} key={'c' + String(t.fields.category ?? '')} placeholder="Kind (e.g. food, title)" aria-label="Kind of word"
                  onBlur={(e) => { if (e.target.value !== String(t.fields.category ?? '')) updateEntity(t.id, { fields: { category: e.target.value } }); }} />
              </div>
              <div className="term-def"><Field long value={String(t.fields.definition ?? '')} placeholder="What it means…" onCommit={(v) => updateEntity(t.id, { fields: { definition: v } })} /></div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
