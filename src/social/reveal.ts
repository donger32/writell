/* "Show in the text" for a comment: open its scene and select the quoted words */
import { getNav, go } from '../nav';

let pending: { sceneId: string; id: string } | null = null;
export function revealComment(pid: string, sceneId: string, id: string) {
  pending = { sceneId, id };
  const r = getNav().route;
  if (!(r.view === 'write' && (r.sceneId === sceneId || r.splitSceneId === sceneId))) go({ view: 'write', projectId: pid, sceneId });
  window.dispatchEvent(new CustomEvent('writell:reveal-comment'));
}
/** The editor asks: is there a comment to show in this scene? (asking clears it) */
export function takeReveal(sceneId: string): string | null {
  if (pending?.sceneId !== sceneId) return null;
  const id = pending.id; pending = null; return id;
}
