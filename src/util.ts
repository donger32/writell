import { isTauri } from './platform';

export interface TextStats { words: number; chars: number; charsNoSpaces: number; sentences: number; paragraphs: number; readingMinutes: number }

export function textStats(text: string): TextStats {
  const trimmed = text.trim();
  const words = trimmed ? (trimmed.match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu) ?? []).length : 0;
  const sentences = trimmed ? (trimmed.match(/[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g) ?? []).filter((s) => /[\p{L}\p{N}]/u.test(s)).length : 0;
  return {
    words,
    chars: text.length,
    charsNoSpaces: text.replace(/\s/g, '').length,
    sentences,
    paragraphs: trimmed ? trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length : 0,
    readingMinutes: words / 238,
  };
}

export const fmtNum = (n: number) => n.toLocaleString();
export const fmtReading = (m: number) => (m < 1 ? '< 1 min' : `${Math.round(m)} min`);

export function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'untitled';

/**
 * Save a file. In the desktop app this opens a native "Save as" dialog;
 * in the browser it triggers a download.
 */
export async function saveFile(name: string, content: string, mime = 'text/plain') {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const ext = name.split('.').pop() ?? 'txt';
    const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await writeTextFile(path, content);
    return true;
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

/** Save binary data (e.g. .docx) — native dialog on desktop, download in browser */
export async function saveBinary(name: string, data: Uint8Array, mime: string) {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const ext = name.split('.').pop() ?? 'bin';
    const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await writeFile(path, data);
    return true;
  }
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

/** Ask the user to pick a file and return its text */
export function pickFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, text: await f.text() });
    };
    input.click();
  });
}
