/*
 * Comments in shared projects live in the project chat, not inside the text, so
 * anyone allowed to comment (even read-only commenters) can add one. This plugin
 * finds each comment's quoted text in the scene and underlines it.
 */
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface Anchor { id: string; quote: string; before?: string; color?: string }
export const sharedCommentsKey = new PluginKey<DecorationSet>('sharedComments');

/** Where a quote is in the document now (best match using the text just before it) */
export function locate(doc: PMNode, quote: string, before?: string): { from: number; to: number } | null {
  const q = quote.split('\n')[0].trim();
  if (q.length < 1) return null;
  let best: { from: number; to: number; score: number } | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // the block's text, and where each character sits in the document
    let text = ''; const at: number[] = [];
    node.forEach((child, off) => { if (child.isText) { for (let i = 0; i < child.text!.length; i++) at.push(pos + 1 + off + i); text += child.text; } else { at.push(pos + 1 + off); text += '￼'; } });
    let i = text.indexOf(q);
    while (i >= 0) {
      const prefix = text.slice(Math.max(0, i - 40), i);
      let score = 1;
      if (before) { let k = 0; while (k < before.length && k < prefix.length && before[before.length - 1 - k] === prefix[prefix.length - 1 - k]) k++; score += k; }
      if (!best || score > best.score) best = { from: at[i], to: at[i + q.length - 1] + 1, score };
      i = text.indexOf(q, i + 1);
    }
    return false;
  });
  return best ? { from: (best as { from: number }).from, to: (best as { to: number }).to } : null;
}

function build(doc: PMNode, anchors: Anchor[]) {
  const decos: Decoration[] = [];
  for (const a of anchors) {
    const r = locate(doc, a.quote, a.before);
    if (r) decos.push(Decoration.inline(r.from, r.to, { class: 'sc-mark', 'data-scid': a.id, ...(a.color ? { style: `--sc: ${a.color}` } : {}) }));
  }
  return DecorationSet.create(doc, decos);
}

export const SharedComments = (getAnchors: () => Anchor[], onOpen: (id: string) => void) => Extension.create({
  name: 'sharedComments',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: sharedCommentsKey,
      state: {
        init: (_, state) => build(state.doc, getAnchors()),
        apply: (tr, old) => (tr.docChanged || tr.getMeta(sharedCommentsKey) ? build(tr.doc, getAnchors()) : old),
      },
      props: {
        decorations: (state) => sharedCommentsKey.getState(state),
        handleClick: (_view, _pos, event) => {
          const el = (event.target as HTMLElement | null)?.closest?.('[data-scid]') as HTMLElement | null;
          if (el?.dataset.scid) onOpen(el.dataset.scid);
          return false;
        },
      },
    })];
  },
});
