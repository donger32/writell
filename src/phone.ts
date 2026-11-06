import { useSyncExternalStore } from 'react';

/** Same rule as the phone layout in styles.css */
export const PHONE_QUERY = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)';
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null;
const sub = (cb: () => void) => { mq?.addEventListener?.('change', cb); return () => mq?.removeEventListener?.('change', cb); };
/** True on phone-sized screens */
export const usePhone = () => useSyncExternalStore(sub, () => !!mq?.matches, () => false);
