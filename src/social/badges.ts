/* Name colors admins can hand out, and name helpers (badges and roles are made in the admin tools: catalog.ts) */
export interface NameColor { id: string; label: string; swatch: string }
export const NAME_COLORS: NameColor[] = [
  { id: 'gold', label: 'Gold', swatch: '#d4a72c' },
  { id: 'ruby', label: 'Ruby', swatch: '#e0455f' },
  { id: 'rose', label: 'Rose', swatch: '#f472b6' },
  { id: 'violet', label: 'Violet', swatch: '#a66cff' },
  { id: 'sky', label: 'Sky', swatch: '#3fa7f5' },
  { id: 'mint', label: 'Mint', swatch: '#2fbf8f' },
  { id: 'lime', label: 'Lime', swatch: '#8bc34a' },
  { id: 'ember', label: 'Ember', swatch: 'linear-gradient(90deg,#ff512f,#f9a825)' },
  { id: 'ocean', label: 'Ocean', swatch: 'linear-gradient(90deg,#2193b0,#6dd5ed)' },
  { id: 'galaxy', label: 'Galaxy', swatch: 'linear-gradient(90deg,#7f5af0,#ff6ec7)' },
  { id: 'rainbow', label: 'Rainbow', swatch: 'linear-gradient(90deg,#ff5f6d,#ffc371,#47e891,#4facfe,#a66cff)' },
];

/** Silly usernames for the "surprise rename" button */
const A = ['captain', 'sir', 'lady', 'tiny', 'grumpy', 'sneaky', 'sleepy', 'mighty', 'soggy', 'cosmic', 'fluffy', 'spicy', 'wobbly', 'secret'];
const N = ['noodle', 'potato', 'pickle', 'waffle', 'goblin', 'muffin', 'llama', 'nugget', 'teapot', 'penguin', 'burrito', 'pancake', 'walrus', 'gremlin'];
/** Usernames admins can give: 1–24 characters, any letters, symbols or emoji, no spaces */
export const specialNameOk = (n: string) => { const len = [...n].length; return len >= 1 && len <= 24 && !/[\s\p{Cc}]/u.test(n); };
export const sillyName = () => `${A[Math.floor(Math.random() * A.length)]}_${N[Math.floor(Math.random() * N.length)]}${Math.floor(Math.random() * 90 + 10)}`;
