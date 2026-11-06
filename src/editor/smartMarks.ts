import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Mark, MarkType } from '@tiptap/pm/model';

/*
 * Word-processor-style formatting toggles.
 *
 * ProseMirror's default: with nothing selected, Ctrl+B only changes the
 * "next typed character" marks, and that choice is forgotten as soon as the
 * cursor moves. Writers expect:
 *   1. Cursor inside a word → the whole word is (un)formatted.
 *   2. Cursor at a word edge → the choice is remembered for that spot, even
 *      if you click elsewhere and come back, until the text changes.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    smartMarks: { smartToggleMark: (markName: string) => ReturnType };
  }
}

const WORD = /[\p{L}\p{N}'’_-]/u;
const key = new PluginKey<{ pos: number; marks: readonly Mark[] } | null>('smartMarks');

function wordRange(state: EditorState): { from: number; to: number } | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, '￼');
  const off = $from.parentOffset;
  // only "inside" a word: word characters on BOTH sides of the cursor
  if (off === 0 || off >= text.length || !WORD.test(text[off - 1]) || !WORD.test(text[off])) return null;
  let s = off, e = off;
  while (s > 0 && WORD.test(text[s - 1])) s--;
  while (e < text.length && WORD.test(text[e])) e++;
  const base = $from.start();
  return { from: base + s, to: base + e };
}

function rangeFullyHas(state: EditorState, from: number, to: number, type: MarkType) {
  let all = true;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
    if (b > a && !type.isInSet(node.marks)) all = false;
  });
  return all;
}

export const SmartMarks = Extension.create({
  name: 'smartMarks',
  priority: 1000,

  addCommands() {
    return {
      smartToggleMark: (markName: string) => ({ state, dispatch }) => {
        const type = state.schema.marks[markName];
        if (!type) return false;
        const sel = state.selection;
        let tr: Transaction = state.tr;

        if (!sel.empty) {
          // normal selection: remove if whole selection has it, else add
          const has = rangeFullyHas(state, sel.from, sel.to, type);
          tr = has ? tr.removeMark(sel.from, sel.to, type) : tr.addMark(sel.from, sel.to, type.create());
        } else {
          const word = wordRange(state);
          if (word) {
            const has = rangeFullyHas(state, word.from, word.to, type);
            tr = has ? tr.removeMark(word.from, word.to, type) : tr.addMark(word.from, word.to, type.create());
            // keep the stored marks in sync so the toolbar shows the new state
            const marks = has ? type.removeFromSet(sel.$from.marks()) : type.create().addToSet(sel.$from.marks());
            tr = tr.setStoredMarks(marks);
          } else {
            const current = state.storedMarks ?? sel.$from.marks();
            const marks = type.isInSet(current) ? type.removeFromSet(current) : type.create().addToSet(current);
            tr = tr.setStoredMarks(marks).setMeta(key, { pos: sel.from, marks });
          }
        }
        if (dispatch) dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    const t = (name: string) => () => this.editor.commands.smartToggleMark(name);
    return {
      'Mod-b': t('bold'), 'Mod-B': t('bold'),
      'Mod-i': t('italic'), 'Mod-I': t('italic'),
      'Mod-u': t('underline'), 'Mod-U': t('underline'),
      'Mod-Shift-s': t('strike'), 'Mod-Shift-x': t('strike'),
      'Mod-Shift-h': t('highlight'),
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: {
        init: () => null,
        apply(tr, value) {
          const meta = tr.getMeta(key);
          if (meta) return meta;
          if (!value) return null;
          if (tr.docChanged) return null; // typing (or any edit) consumes the remembered choice
          return value;
        },
      },
      appendTransaction(_trs, _old, state) {
        const memo = key.getState(state);
        const sel = state.selection;
        if (!memo || !sel.empty || sel.from !== memo.pos) return null;
        const cur = state.storedMarks;
        if (cur && cur.length === memo.marks.length && cur.every((m) => m.isInSet(memo.marks))) return null;
        return state.tr.setStoredMarks(memo.marks);
      },
    })];
  },
});
