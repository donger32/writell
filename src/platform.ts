/** True when running inside the Tauri desktop app (Windows/Mac/Linux) */
export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Ask the browser not to evict our IndexedDB data under storage pressure.
 * Chrome grants this automatically for installed apps / frequently used sites.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
