import { Mark, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

/*
 * Revision marks. They are invisible in writing mode (CSS only shows them
 * inside `.editing`) and are dropped from every export.
 *   comment: { id }            → comment thread stored as an entity (kind 'comment')
 *   flag:    { kind, note }    → 'revise' (needs work) or 'unfinished'
 */

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() { return { id: { default: null, parseHTML: (el) => el.getAttribute('data-comment'), renderHTML: (a) => ({ 'data-comment': a.id }) } }; },
  parseHTML() { return [{ tag: 'span[data-comment]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { class: 'c-mark' }), 0]; },
  renderMarkdown: (node, h) => h.renderChildren(node),
});

export const FlagMark = Mark.create({
  name: 'flag',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      kind: { default: 'revise', parseHTML: (el) => el.getAttribute('data-flag'), renderHTML: (a) => ({ 'data-flag': a.kind }) },
      note: { default: '', parseHTML: (el) => el.getAttribute('title') ?? '', renderHTML: (a) => (a.note ? { title: a.note } : {}) },
    };
  },
  parseHTML() { return [{ tag: 'span[data-flag]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { class: 'f-mark' }), 0]; },
  renderMarkdown: (node, h) => h.renderChildren(node),
});

/** Find the document range(s) covered by a comment id */
export function findMarkRanges(editor: Editor, name: 'comment' | 'flag', match: (attrs: Record<string, unknown>) => boolean) {
  const out: { from: number; to: number; attrs: Record<string, unknown>; text: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const m = node.marks.find((mk) => mk.type.name === name && match(mk.attrs));
    if (!m) return;
    const last = out[out.length - 1];
    if (last && last.to === pos && last.attrs === m.attrs) { last.to = pos + node.nodeSize; last.text += node.text; }
    else out.push({ from: pos, to: pos + node.nodeSize, attrs: m.attrs, text: node.text ?? '' });
  });
  return out;
}

export function removeMarkById(editor: Editor, name: 'comment', id: string) {
  const type = editor.schema.marks[name];
  let tr = editor.state.tr;
  for (const r of findMarkRanges(editor, name, (a) => a.id === id)) tr = tr.removeMark(r.from, r.to, type);
  editor.view.dispatch(tr);
}
