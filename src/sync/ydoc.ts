/*
 * Live co-writing: in shared projects each scene's text is also kept as a Yjs
 * document ("ystate"), which merges everyone's edits instead of replacing them.
 */
import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import type { Schema } from '@tiptap/pm/model';
import { b64, unb64 } from './crypto';

export const FIELD = 'default';
export const REMOTE = 'writell-remote';

/** The scene's live document: from its saved state, or built from its text the same way on every device */
export function sceneDoc(ystate: string | undefined, content: unknown, schema: Schema): Y.Doc {
  const doc = new Y.Doc();
  if (ystate) { Y.applyUpdate(doc, unb64(ystate), REMOTE); return doc; }
  // a fixed "author" for the starting text, so two devices that start from the same text end up with one copy, not two
  const seed = new Y.Doc(); seed.clientID = 0;
  const json = content && typeof content === 'object' ? content : { type: 'doc', content: [{ type: 'paragraph' }] };
  prosemirrorJSONToYXmlFragment(schema, json as Record<string, unknown>, seed.getXmlFragment(FIELD));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed), REMOTE);
  return doc;
}
export const encodeDoc = (doc: Y.Doc) => b64(Y.encodeStateAsUpdate(doc));
export const docContent = (doc: Y.Doc) => yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(FIELD));

/** Combine two saved versions of a scene. `same` = the result is just `b` (nothing of `a` was missing from it). */
export function mergeStates(a: string, b: string): { ystate: string; content: unknown; same: boolean } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, unb64(a)); Y.applyUpdate(doc, unb64(b));
  const onlyB = new Y.Doc(); Y.applyUpdate(onlyB, unb64(b));
  const merged = encodeDoc(doc);
  return { ystate: merged, content: docContent(doc), same: merged === encodeDoc(onlyB) };
}
