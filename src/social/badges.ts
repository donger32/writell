/* Cosmetics admins can hand out: badges, name colors, staff ranks */
export interface Badge { id: string; emoji: string; label: string }
export const BADGES: Badge[] = [
  { id: 'verified', emoji: '✅', label: 'Verified' },
  { id: 'og', emoji: '🏛️', label: 'OG' },
  { id: 'early', emoji: '🌱', label: 'Early bird' },
  { id: 'star', emoji: '🌟', label: 'Writer of the week' },
  { id: 'wordsmith', emoji: '✒️', label: 'Wordsmith' },
  { id: 'twist', emoji: '🌀', label: 'Plot twister' },
  { id: 'speed', emoji: '⚡', label: 'Speed typist' },
  { id: 'night', emoji: '🦉', label: 'Night owl' },
  { id: 'coffee', emoji: '☕', label: 'Runs on coffee' },
  { id: 'fire', emoji: '🔥', label: 'On fire' },
  { id: 'ghost', emoji: '👻', label: 'Ghost writer' },
  { id: 'dragon', emoji: '🐉', label: 'Dragon tamer' },
  { id: 'skull', emoji: '💀', label: 'Killed off a main character' },
  { id: 'bug', emoji: '🐛', label: 'Bug hunter' },
  { id: 'heart', emoji: '💖', label: 'Wholesome' },
  { id: 'legend', emoji: '🏆', label: 'Legend' },
  { id: 'goat', emoji: '🐐', label: 'GOAT' },
  { id: 'crown', emoji: '👑', label: 'Royalty' },
  { id: 'clown', emoji: '🤡', label: 'Certified clown' },
  { id: 'potato', emoji: '🥔', label: 'Potato' },
];
export const badge = (id: string) => BADGES.find((b) => b.id === id);

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

export type Staff = 'owner' | 'admin' | 'mod';
export const STAFF_LABEL: Record<Staff, string> = { owner: 'Writell owner', admin: 'Admin', mod: 'Moderator' };
export const RANK: Record<string, number> = { owner: 3, admin: 2, mod: 1 };
export const rankOf = (s?: string | null) => (s ? RANK[s] ?? 0 : 0);

/** Silly usernames for the "surprise rename" button */
const A = ['captain', 'sir', 'lady', 'tiny', 'grumpy', 'sneaky', 'sleepy', 'mighty', 'soggy', 'cosmic', 'fluffy', 'spicy', 'wobbly', 'secret'];
const N = ['noodle', 'potato', 'pickle', 'waffle', 'goblin', 'muffin', 'llama', 'nugget', 'teapot', 'penguin', 'burrito', 'pancake', 'walrus', 'gremlin'];
/** Usernames admins can give: 1–24 characters, any letters, symbols or emoji, no spaces */
export const specialNameOk = (n: string) => { const len = [...n].length; return len >= 1 && len <= 24 && !/[\s\p{Cc}]/u.test(n); };
export const sillyName = () => `${A[Math.floor(Math.random() * A.length)]}_${N[Math.floor(Math.random() * N.length)]}${Math.floor(Math.random() * 90 + 10)}`;
