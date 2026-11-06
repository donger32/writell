/*
 * Everything that holds unsaved text (editors, profile fields) registers a
 * flush function here, so the app can save it all before the window closes.
 */
const flushers = new Set<() => unknown>();
export function registerFlush(fn: () => unknown) { flushers.add(fn); return () => { flushers.delete(fn); }; }
export async function flushAll() { await Promise.allSettled([...flushers].map((f) => f())); }
