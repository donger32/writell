import { autoBackup, db, exportProject } from './db';
import { isTauri } from './platform';
import { getSettings } from './settings';
import { safeName } from './util';

/*
 * Background backup loop.
 * - Every N minutes, any project edited since its last backup gets a rotated
 *   in-app backup (db.backups).
 * - Desktop only: also writes `<Project> YYYY-MM-DD HHmm.inkwell.json` into the
 *   user-chosen backup folder, keeping the 10 newest per project.
 */

const FOLDER_KEY = 'inkwell.backupFolder';
export const getBackupFolder = () => { try { return localStorage.getItem(FOLDER_KEY); } catch { return null; } };

export async function chooseBackupFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const dir = await open({ directory: true, title: 'Choose a folder for Writell backups' });
  if (typeof dir === 'string') { try { localStorage.setItem(FOLDER_KEY, dir); } catch { /* */ } return dir; }
  return getBackupFolder();
}

const lastBackup = new Map<string, number>();

async function writeFolderBackup(projectId: string) {
  const folder = getBackupFolder();
  if (!folder) return;
  const fs = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');
  const data = await exportProject(projectId);
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const base = safeName(data.project.title);
  const name = `${base} ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}.writell.json`;
  await fs.writeTextFile(await join(folder, name), JSON.stringify(data));
  const entries = (await fs.readDir(folder)).filter((e) => e.isFile && e.name.startsWith(base + ' ') && (e.name.endsWith('.writell.json') || e.name.endsWith('.inkwell.json'))).map((e) => e.name).sort();
  for (const old of entries.slice(0, Math.max(0, entries.length - 10))) await fs.remove(await join(folder, old));
}

export async function runBackups() {
  const projects = await db.projects.toArray();
  for (const p of projects) {
    if (p.updatedAt <= (lastBackup.get(p.id) ?? 0)) continue;
    try {
      await autoBackup(p.id);
      if (isTauri()) await writeFolderBackup(p.id);
      lastBackup.set(p.id, Date.now());
    } catch (e) { console.error('Backup failed', p.title, e); }
  }
}

export function startBackupLoop() {
  // seed so we don't back up untouched projects at every launch
  db.backups.toArray().then((all) => all.forEach((b) => lastBackup.set(b.projectId, Math.max(lastBackup.get(b.projectId) ?? 0, b.createdAt))));
  let last = Date.now();
  window.setInterval(() => {
    const mins = getSettings().autoBackupMinutes;
    if (!mins) return;
    if (Date.now() - last >= mins * 60_000) { last = Date.now(); runBackups(); }
  }, 30_000);
}
