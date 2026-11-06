import { useEffect, useState, type RefObject } from 'react';

/**
 * Self-healing for diagram views: if after an update any node is left hidden
 * (not measured) or lines are missing, re-mount the diagram — the same thing
 * that happens when you switch away and come back.
 */
export function useFlowWatchdog(host: RefObject<HTMLElement | null>, expectedEdges: number, deps: unknown[]) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    let tries = 0;
    let t: number;
    const check = () => {
      const el = host.current;
      if (!el) return;
      const nodes = Array.from(el.querySelectorAll<HTMLElement>('.react-flow__node'));
      const hidden = nodes.some((n) => n.style.visibility === 'hidden' || getComputedStyle(n).visibility === 'hidden');
      const drawn = el.querySelectorAll('.react-flow__edge-path').length;
      if (nodes.length && (hidden || drawn < expectedEdges)) {
        if (++tries < 3) { t = window.setTimeout(check, 250); return; }
        setKey((k) => k + 1);
      }
    };
    t = window.setTimeout(check, 350);
    return () => clearTimeout(t);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return key;
}
