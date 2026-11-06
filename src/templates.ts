import { db, uid, now, emptyDoc } from './db';

export interface Template { id: string; name: string; description: string; words: number; chapters: { title: string; summary?: string }[] }

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank', description: 'One empty chapter. Build your own structure.', words: 0, chapters: [{ title: 'Chapter 1' }] },
  { id: 'three-act', name: 'Three-act novel', description: 'Setup, confrontation and resolution with the key turning points.', words: 80000, chapters: [
    { title: 'Opening image', summary: 'Act I. The hero\'s ordinary world and what is missing.' },
    { title: 'Inciting incident', summary: 'Something disrupts the ordinary world.' },
    { title: 'Debate', summary: 'The hero hesitates. What are the stakes?' },
    { title: 'Plot point one', summary: 'The hero commits; no going back.' },
    { title: 'Rising action', summary: 'Act II. New world, allies, enemies, tests.' },
    { title: 'Midpoint', summary: 'A false victory or false defeat raises the stakes.' },
    { title: 'Closing in', summary: 'Opposition tightens; cracks inside the team.' },
    { title: 'All is lost', summary: 'The lowest point.' },
    { title: 'Plot point two', summary: 'A new insight gives the hero a way forward.' },
    { title: 'Climax', summary: 'Act III. The final confrontation.' },
    { title: 'Resolution', summary: 'The new normal; how the hero has changed.' },
  ] },
  { id: 'heros-journey', name: "Hero's journey", description: 'Twelve stages of the classic monomyth.', words: 90000, chapters: [
    'Ordinary world', 'Call to adventure', 'Refusal of the call', 'Meeting the mentor', 'Crossing the threshold', 'Tests, allies, enemies',
    'Approach to the inmost cave', 'The ordeal', 'Reward', 'The road back', 'Resurrection', 'Return with the elixir',
  ].map((title) => ({ title })) },
  { id: 'mystery', name: 'Mystery', description: 'Crime, investigation, twists and the reveal.', words: 75000, chapters: [
    { title: 'The crime', summary: 'The body, the theft, the disappearance.' }, { title: 'The detective', summary: 'Who investigates, and why it is personal.' },
    { title: 'First suspects', summary: 'Interviews; everyone hides something.' }, { title: 'False lead' }, { title: 'Second crime', summary: 'Stakes rise.' },
    { title: 'The twist' }, { title: 'Detective in danger' }, { title: 'The reveal', summary: 'All clues come together.' }, { title: 'Aftermath' },
  ] },
  { id: 'short-story', name: 'Short story', description: 'Beginning, middle and end in a few scenes.', words: 6000, chapters: [{ title: 'Beginning' }, { title: 'Middle' }, { title: 'End' }] },
];

export async function createFromTemplate(title: string, description: string, templateId: string, goalWords?: number) {
  const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const id = uid();
  const t = now();
  await db.transaction('rw', db.projects, db.chapters, db.scenes, async () => {
    await db.projects.add({ id, title, description, color: '#8b7cf6', favorite: false, archived: false, goalWords: goalWords ?? tpl.words, createdAt: t, updatedAt: t, openedAt: t });
    for (let i = 0; i < tpl.chapters.length; i++) {
      const chId = uid();
      await db.chapters.add({ id: chId, projectId: id, title: tpl.chapters[i].title, summary: tpl.chapters[i].summary ?? '', notes: '', order: i, status: tpl.id === 'blank' ? 'draft' : 'idea', color: '', createdAt: t, updatedAt: t });
      await db.scenes.add({ id: uid(), projectId: id, chapterId: chId, title: 'Scene 1', summary: '', notes: '', order: 0, status: tpl.id === 'blank' ? 'draft' : 'idea', content: emptyDoc, words: 0, createdAt: t, updatedAt: t });
    }
  });
  return id;
}
