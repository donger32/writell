import type { Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

const WORD = /[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu; // must start with a letter or number (a lone dash isn't a word)
const countWords = (s: string) => (s.match(WORD) ?? []).length;

/** the text of the whole paragraphs around a range (words never cross paragraphs) */
function around(doc: PMNode, from: number, to: number) {
  const size = doc.content.size;
  from = Math.max(0, Math.min(from, size)); to = Math.max(from, Math.min(to, size));
  const a = doc.resolve(from), b = doc.resolve(to);
  const start = a.parent.isTextblock ? a.start() : from;
  const end = b.parent.isTextblock ? b.end() : to;
  return doc.textBetween(start, end, '\n\n', ' ');
}

/**
 * How many words an edit added (or removed, if negative), looking only at the paragraphs it touched.
 * Counting the whole scene on every key press made very long scenes lag.
 */
export function wordDelta(tr: Transaction): number {
  let delta = 0;
  tr.steps.forEach((step, i) => {
    const before = tr.docs[i], after = tr.docs[i + 1] ?? tr.doc;
    step.getMap().forEach((os, oe, ns, ne) => { delta += countWords(around(after, ns, ne)) - countWords(around(before, os, oe)); });
  });
  return delta;
}
