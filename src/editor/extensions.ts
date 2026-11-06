import { Editor, Extension, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { SmartMarks } from './smartMarks';
import { CommentMark, FlagMark } from './reviewMarks';
import { InsertionMark, DeletionMark, TrackChanges } from './trackChanges';
import { CharacterMentions, type MentionName } from './mentions';

/** Dims every top-level block except the one containing the cursor */
export const FocusParagraph = Extension.create<{ enabled: () => boolean }>({
  name: 'focusParagraph',
  addOptions() { return { enabled: () => false }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key: new PluginKey('focusParagraph'),
      props: {
        decorations(state) {
          if (!opts.enabled()) return null;
          const { $from } = state.selection;
          if ($from.depth < 1) return null;
          const start = $from.before(1);
          const node = state.doc.nodeAt(start);
          if (!node) return null;
          return DecorationSet.create(state.doc, [Decoration.node(start, start + node.nodeSize, { class: 'is-focused' })]);
        },
      },
    })];
  },
});

export function baseExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
      code: false,
      link: { openOnClick: false, autolink: true },
    }),
    Highlight,
    Typography.configure({ oneHalf: false, oneQuarter: false, threeQuarters: false }),
    Markdown,
    CommentMark,
    FlagMark,
    InsertionMark,
    DeletionMark,
  ];
}

export function editorExtensions(focusEnabled: () => boolean, tracking: () => boolean = () => false, mentions?: { names: () => MentionName[]; enabled: () => boolean }) {
  return [
    ...baseExtensions(),
    SmartMarks,
    Placeholder.configure({ placeholder: 'Start writing…' }),
    CharacterCount,
    FocusParagraph.configure({ enabled: focusEnabled }),
    TrackChanges.configure({ enabled: tracking }),
    ...(mentions ? [CharacterMentions.configure(mentions)] : []),
  ];
}

/* Headless converter so we can export / import without an open editor */
let converter: Editor | null = null;
function conv() {
  if (!converter) converter = new Editor({ element: null, extensions: baseExtensions(), content: '' });
  return converter;
}
export function jsonToMarkdown(doc: unknown): string {
  return conv().markdown!.serialize(doc as JSONContent);
}
export function markdownToJson(md: string): JSONContent {
  return conv().markdown!.parse(md);
}
export function jsonToText(doc: unknown): string {
  const e = conv();
  e.commands.setContent(withoutDeletions(doc) as JSONContent, { emitUpdate: false });
  return e.getText({ blockSeparator: '\n\n' });
}
export function htmlToJson(html: string): JSONContent {
  const e = conv();
  e.commands.setContent(html, { emitUpdate: false });
  return e.getJSON();
}

/** Plain text of a scene, cached until the scene changes (keeps search fast on long novels) */
const textCache = new Map<string, { at: number; text: string }>();
export function sceneText(s: { id: string; updatedAt: number; content: unknown }): string {
  const c = textCache.get(s.id);
  if (c && c.at === s.updatedAt) return c.text;
  const text = jsonToText(s.content);
  textCache.set(s.id, { at: s.updatedAt, text });
  return text;
}

/** Copy of a document without text that is only a suggested deletion (track changes) */
export function withoutDeletions(doc: unknown): unknown {
  const walk = (n: JSONContent): JSONContent | null => {
    if (n.type === 'text' && n.marks?.some((m) => m.type === 'deletion')) return null;
    if (!n.content) return n;
    return { ...n, content: n.content.map(walk).filter(Boolean) as JSONContent[] };
  };
  return walk(doc as JSONContent);
}
