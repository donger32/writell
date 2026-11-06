import { Extension, Mark, mergeAttributes, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { ReplaceStep } from '@tiptap/pm/transform';

/*
 * Track changes (suggestion mode).
 * While on, typed text gets an `insertion` mark and deleted text is kept with
 * a `deletion` mark (shown struck through) instead of disappearing.
 * Accepting/rejecting turns suggestions into real edits.
 * Limits: splitting/joining paragraphs and list restructuring are applied
 * directly (not tracked) — only text within a paragraph is tracked.
 */

export const SKIP = 'trackSkip';

export const InsertionMark = Mark.create({
  name: 'insertion',
  inclusive: true,
  excludes: 'insertion deletion',
  addAttributes() { return { at: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-at') || 0), renderHTML: (a) => ({ 'data-at': a.at }) } }; },
  parseHTML() { return [{ tag: 'ins[data-ins]' }]; },
  renderHTML({ HTMLAttributes }) { return ['ins', mergeAttributes(HTMLAttributes, { 'data-ins': '', class: 'tc-ins' }), 0]; },
  renderMarkdown: (node, h) => h.renderChildren(node),
});

export const DeletionMark = Mark.create({
  name: 'deletion',
  inclusive: false,
  excludes: 'insertion deletion',
  addAttributes() { return { at: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-at') || 0), renderHTML: (a) => ({ 'data-at': a.at }) } }; },
  parseHTML() { return [{ tag: 'del[data-del]' }]; },
  renderHTML({ HTMLAttributes }) { return ['del', mergeAttributes(HTMLAttributes, { 'data-del': '', class: 'tc-del' }), 0]; },
  renderMarkdown: () => '', // suggested deletions never reach exports
});

const key = new PluginKey('trackChanges');

export const TrackChanges = Extension.create<{ enabled: () => boolean }>({
  name: 'trackChanges',
  priority: 1000, // its Backspace/Delete must run before the default ones
  addOptions() { return { enabled: () => false }; },
  // Backspace / Delete while tracking: hop over text that is already crossed out,
  // then cross out the next real letter (or truly remove your own suggestion).
  addKeyboardShortcuts() {
    const run = (dir: -1 | 1) => () => {
      if (!this.options.enabled()) return false;
      const view = this.editor.view;
      // read where the caret really is, even when keys come in quickly
      (view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
      const state = view.state;
      const sel = state.selection;
      if (!sel.empty) return false;
      const del = state.schema.marks.deletion, ins = state.schema.marks.insertion;
      if (!del || !ins) return false;
      const $p = sel.$from;
      if (!$p.parent.inlineContent) return false;
      const start = $p.start(), end = $p.end();
      let pos = sel.from;
      const charAt = (a: number) => state.doc.nodeAt(a);
      // skip already-deleted text
      while (dir < 0 ? pos > start : pos < end) {
        const n = charAt(dir < 0 ? pos - 1 : pos);
        if (!n || !n.isText || !del.isInSet(n.marks)) break;
        pos += dir;
      }
      if (dir < 0 ? pos <= start : pos >= end) {
        // only crossed-out text between the caret and the paragraph edge: just move there
        if (pos === sel.from) return false;
        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)).setMeta(SKIP, true));
        return true;
      }
      // one character (keep emoji / surrogate pairs whole)
      let a = dir < 0 ? pos - 1 : pos, b = a + 1;
      if (dir < 0 && a - 1 >= start && /[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(state.doc.textBetween(a - 1, b))) a -= 1;
      if (dir > 0 && b + 1 <= end && /^[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(state.doc.textBetween(a, b + 1))) b += 1;
      const n = charAt(a);
      if (!n || !n.isText) return false;
      const tr = state.tr.setMeta(SKIP, true);
      if (ins.isInSet(n.marks)) {
        tr.delete(a, b);
        tr.setSelection(TextSelection.create(tr.doc, a));
      } else {
        // join the neighbouring crossed-out run so it stays one piece
        let stamp = Date.now();
        for (const q of [a - 1, b]) { const m = q >= start && q < end ? charAt(q) : null; const dm = m && del.isInSet(m.marks); if (dm) stamp = Number(dm.attrs.at) || stamp; }
        tr.addMark(a, b, del.create({ at: stamp }));
        tr.setSelection(TextSelection.create(tr.doc, dir < 0 ? a : b));
      }
      view.dispatch(tr.scrollIntoView());
      return true;
    };
    return { Backspace: run(-1), Delete: run(1) };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key,
      appendTransaction(trs, oldState, newState) {
        if (!opts.enabled()) return null;
        const changed = trs.filter((t) => t.docChanged);
        if (changed.length !== 1) return null;
        const tr0 = changed[0];
        if (tr0.getMeta(SKIP) || tr0.getMeta('history$') || tr0.getMeta('appendedTransaction')) return null;
        const ins = newState.schema.marks.insertion, del = newState.schema.marks.deletion;
        if (!ins || !del) return null;
        const at = Date.now();
        const out = newState.tr.setMeta(SKIP, true);
        const reinserts: { pos: number; frag: Fragment; from: number; to: number }[] = [];

        tr0.steps.forEach((step, i) => {
          if (!(step instanceof ReplaceStep)) return;
          const before = tr0.docs[i];
          const { from, to, slice } = step as unknown as { from: number; to: number; slice: { size: number; content: Fragment; openStart: number; openEnd: number } };
          const rest = tr0.mapping.slice(i + 1);
          // inserted inline text → insertion mark
          const inlineInsert = slice.size > 0 && slice.openStart === 0 && slice.openEnd === 0 && allInline(slice.content);
          if (inlineInsert) {
            // continue an adjacent suggestion instead of starting a new one
            const a = rest.map(from, -1), b = rest.map(from + slice.size, 1);
            let stamp = at;
            newState.doc.nodesBetween(Math.max(0, a - 1), Math.min(newState.doc.content.size, b + 1), (n) => { const m = ins.isInSet(n.marks); if (m) stamp = Math.min(stamp, Number(m.attrs.at) || at); });
            out.addMark(a, b, ins.create({ at: stamp }));
          }
          // deleted inline text → keep it, struck through
          if (to > from) {
            const $a = before.resolve(from), $b = before.resolve(to);
            if ($a.parent !== $b.parent || !$a.parent.inlineContent) return;
            const kept: PMNode[] = [];
            let dstamp = at;
            for (const q of [from - 1, to]) { if (q < $a.start() || q >= $a.end()) continue; const m = before.nodeAt(q); const dm = m && del.isInSet(m.marks); if (dm) dstamp = Number(dm.attrs.at) || dstamp; }
            before.slice(from, to).content.forEach((n) => {
              if (!n.isInline) return;
              if (ins.isInSet(n.marks)) return;            // deleting your own suggestion = really delete
              kept.push(del.isInSet(n.marks) ? n : n.mark(del.create({ at: dstamp }).addToSet(n.marks)));
            });
            if (kept.length) reinserts.push({ pos: rest.map(from, -1), frag: Fragment.fromArray(kept), from, to });
          }
        });
        if (!reinserts.length && !out.steps.length) return null;

        reinserts.sort((a, b) => b.pos - a.pos);
        for (const r of reinserts) out.insert(r.pos, r.frag);

        // caret: Backspace leaves it before the struck text, Delete after it
        if (reinserts.length === 1) {
          const r = reinserts[0];
          const old = oldState.selection;
          const pos = out.mapping.map(r.pos, -1);
          if (old.empty && old.from === r.to) out.setSelection(TextSelection.create(out.doc, pos));
          else if (old.empty && old.from === r.from) out.setSelection(TextSelection.create(out.doc, pos + r.frag.size));
        }
        return out;
      },
    })];
  },
});

function allInline(f: Fragment) { let ok = true; f.forEach((n) => { if (!n.isInline) ok = false; }); return ok; }

/* ---------- reviewing suggestions ---------- */

export interface Change { kind: 'insertion' | 'deletion'; from: number; to: number; text: string; at: number }

export function listChanges(editor: Editor): Change[] {
  const out: Change[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const kind of ['insertion', 'deletion'] as const) {
      const m = node.marks.find((x) => x.type.name === kind);
      if (!m) continue;
      const last = out[out.length - 1];
      if (last && last.kind === kind && last.to === pos) { last.to = pos + node.nodeSize; last.text += node.text; }
      else out.push({ kind, from: pos, to: pos + node.nodeSize, text: node.text ?? '', at: Number(m.attrs.at) });
    }
  });
  return out;
}

function resolve(tr: Transaction, editor: Editor, c: Change, accept: boolean) {
  const type = editor.schema.marks[c.kind];
  const from = tr.mapping.map(c.from), to = tr.mapping.map(c.to);
  const keep = (c.kind === 'insertion') === accept;
  if (keep) tr.removeMark(from, to, type); else tr.delete(from, to);
}

export function resolveChange(editor: Editor, c: Change, accept: boolean) {
  const tr = editor.state.tr.setMeta(SKIP, true);
  resolve(tr, editor, c, accept);
  editor.view.dispatch(tr);
}

export function resolveAll(editor: Editor, accept: boolean) {
  const changes = listChanges(editor);
  if (!changes.length) return 0;
  const tr = editor.state.tr.setMeta(SKIP, true);
  for (const c of changes) resolve(tr, editor, c, accept);
  editor.view.dispatch(tr);
  return changes.length;
}
