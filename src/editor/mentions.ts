/*
 * Finds characters' names (and nicknames) in the text and marks them, so the
 * editor can show a hover card. Nothing is stored in the document: these are
 * view-only decorations, recomputed as you type or as characters change.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { autoColor } from '../entities';

export interface MentionName { id: string; text: string; color?: string }
export const mentionsKey = new PluginKey<DecorationSet>('characterMentions');

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Matcher = { re: RegExp; byText: Map<string, MentionName> } | null;
let lastKey = '', lastMatcher: Matcher = null;
function matcher(names: MentionName[]): Matcher {
  const key = names.map((n) => n.id + '\u0001' + n.text + '\u0001' + (n.color ?? '')).join('\u0002');
  if (key === lastKey) return lastMatcher;
  lastKey = key;
  if (!names.length) return (lastMatcher = null);
  const byText = new Map<string, MentionName>();
  for (const n of names) if (!byText.has(n.text)) byText.set(n.text, n);
  const alts = [...byText.keys()].sort((a, b) => b.length - a.length).map(esc);
  return (lastMatcher = { re: new RegExp(`(?<![\\p{L}\\p{N}_])(${alts.join('|')})(?![\\p{L}\\p{N}_])`, 'gu'), byText });
}

/** the marks for one paragraph (or heading) */
function blockDecos(node: PMNode, pos: number, m: NonNullable<Matcher>, enabled: boolean, out: Decoration[]) {
  // the block's text, with non-text inline nodes as a placeholder so offsets line up
  let text = '';
  node.forEach((child) => { text += child.isText ? child.text : '\ufffc'.repeat(child.nodeSize); });
  for (const hitM of text.matchAll(m.re)) {
    const hit = m.byText.get(hitM[1]);
    if (!hit) continue;
    const from = pos + 1 + hitM.index!, to = from + hitM[1].length;
    const term = hit.id.startsWith('term:');
    out.push(Decoration.inline(from, to, !enabled ? { spellcheck: 'false' }
      : term ? { class: 'term-mention', 'data-term': hit.id.slice(5), spellcheck: 'false' }
      : { class: 'char-mention', 'data-char': hit.id, spellcheck: 'false', ...(hit.color ? { style: `--mc:${hit.color}` } : {}) }));
  }
}

function build(doc: PMNode, names: MentionName[], enabled: boolean): DecorationSet {
  // with character cards off, names are still kept out of the spellchecker
  const m = matcher(names);
  if (!m) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    blockDecos(node, pos, m, enabled, decos);
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/** after an edit: keep the marks everywhere else, redo only the paragraphs that changed (long scenes stay fast) */
function update(tr: Transaction, old: DecorationSet, names: MentionName[], enabled: boolean): DecorationSet {
  const m = matcher(names);
  if (!m) return DecorationSet.empty;
  const doc = tr.doc, size = doc.content.size;
  const ranges: [number, number][] = [];
  const maps = tr.mapping.maps;
  maps.forEach((map, i) => map.forEach((_os, _oe, ns, ne) => {
    let from = ns, to = ne;
    for (let j = i + 1; j < maps.length; j++) { from = maps[j].map(from, -1); to = maps[j].map(to, 1); }
    ranges.push([from, to]);
  }));
  let set = old.map(tr.mapping, doc);
  const done = new Set<number>();
  for (const [f, t] of ranges) {
    const from = Math.max(0, Math.min(f, size)), to = Math.min(size, Math.max(t, from + 1));
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (done.has(pos)) return false;
      done.add(pos);
      const stale = set.find(pos, pos + node.nodeSize);
      if (stale.length) set = set.remove(stale);
      const fresh: Decoration[] = [];
      blockDecos(node, pos, m, enabled, fresh);
      if (fresh.length) set = set.add(doc, fresh);
      return false;
    });
  }
  return set;
}

export const CharacterMentions = Extension.create<{ names: () => MentionName[]; enabled: () => boolean }>({
  name: 'characterMentions',
  addOptions() { return { names: () => [], enabled: () => true }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin<DecorationSet>({
      key: mentionsKey,
      state: {
        init: (_, state: EditorState) => build(state.doc, opts.names(), opts.enabled()),
        apply: (tr, old) => (tr.getMeta(mentionsKey) ? build(tr.doc, opts.names(), opts.enabled()) : tr.docChanged ? update(tr, old, opts.names(), opts.enabled()) : old),
      },
      props: { decorations(state) { return mentionsKey.getState(state); } },
    })];
  },
});

/** Turn characters into the names to look for: full name, nicknames, and a first name when only one character has it */
export function mentionNames(chars: { id: string; name: string; fields: Record<string, unknown> }[]): MentionName[] {
  const out: MentionName[] = [];
  const firstCount = new Map<string, number>();
  const first = (n: string) => n.trim().split(/\s+/)[0] ?? '';
  for (const c of chars) { const f = first(c.name); if (f) firstCount.set(f, (firstCount.get(f) ?? 0) + 1); }
  for (const c of chars) {
    const color = (c.fields.color as string) || autoColor(c.name);
    const name = c.name.trim();
    if (name.length >= 2 && name !== 'Unnamed') out.push({ id: c.id, text: name, color });
    const f = first(name);
    if (f !== name && f.length >= 3 && firstCount.get(f) === 1) out.push({ id: c.id, text: f, color });
    for (const nick of String(c.fields.nicknames ?? '').split(/[,;\n]/)) {
      const t = nick.trim().replace(/^["“']|["”']$/g, '');
      if (t.length >= 2) out.push({ id: c.id, text: t, color });
    }
  }
  return out;
}

/** Glossary words (and the other ways they're written) to underline in the text. Ids are prefixed "term:". */
export function termNames(terms: { id: string; name: string; fields: Record<string, unknown> }[]): MentionName[] {
  const out: MentionName[] = [];
  const add = (id: string, t: string) => {
    t = t.trim(); if (t.length < 2) return;
    out.push({ id: 'term:' + id, text: t });
    // also at the start of a sentence, or written in lower case in the middle of one
    const up = t.charAt(0).toUpperCase() + t.slice(1), low = t.charAt(0).toLowerCase() + t.slice(1);
    if (up !== t) out.push({ id: 'term:' + id, text: up });
    if (low !== t) out.push({ id: 'term:' + id, text: low });
  };
  for (const e of terms) {
    add(e.id, e.name);
    for (const a of String(e.fields.aliases ?? '').split(/[,;\n]/)) add(e.id, a);
  }
  return out;
}
