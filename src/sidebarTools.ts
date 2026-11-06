export const PROJECT_TOOLS = [
  { id: 'overview', label: 'Overview' },
  { id: 'characters', label: 'Character' },
  { id: 'world', label: 'Worldbuilding' },
  { id: 'notes', label: 'Notes' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'maps', label: 'Map' },
  { id: 'family', label: 'Tree' },
  { id: 'relationships', label: 'Relation' },
  { id: 'timelines', label: 'Timeline' },
  { id: 'statistics', label: 'Statistics' },
  { id: 'search', label: 'Search project' },
] as const;

/** Reachable elsewhere (Statistics in the workspace list, search in the project header), so off by default */
export const HIDDEN_BY_DEFAULT = new Set(['statistics', 'search']);
export const defaultTools = () => PROJECT_TOOLS.map((t) => ({ id: t.id as string, visible: !HIDDEN_BY_DEFAULT.has(t.id) }));

/** Merge saved order/visibility with the full tool list (new tools appear at the end) */
export function orderedTools(saved: { id: string; visible: boolean }[]) {
  const known = saved.filter((x) => PROJECT_TOOLS.some((t) => t.id === x.id));
  const rest = PROJECT_TOOLS.filter((t) => !known.some((k) => k.id === t.id)).map((t) => ({ id: t.id, visible: !HIDDEN_BY_DEFAULT.has(t.id) }));
  return [...known, ...rest].map((x) => ({ ...x, label: PROJECT_TOOLS.find((t) => t.id === x.id)!.label }));
}
