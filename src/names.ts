/* Name generator for the dice button: made-up names in a handful of styles. */

export const NAME_STYLES = [
  { id: 'everyday', label: 'Everyday', hint: 'Maya Holloway' },
  { id: 'fantasy', label: 'Fantasy', hint: 'Tharan Ashvale' },
  { id: 'elvish', label: 'Elvish', hint: 'Sylaeth Moonwhisper' },
  { id: 'harsh', label: 'Harsh', hint: 'Grakkus Ironjaw' },
  { id: 'nordic', label: 'Nordic', hint: 'Sigrid Torvaldsdottir' },
  { id: 'ancient', label: 'Ancient', hint: 'Cassia Varro' },
  { id: 'scifi', label: 'Sci-fi', hint: 'Kaelen Voss' },
] as const;
export type NameStyle = (typeof NAME_STYLES)[number]['id'];

const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const EVERY_FIRST = ['Maya', 'Elena', 'Clara', 'Nora', 'Iris', 'Hazel', 'Lena', 'Ruth', 'Ada', 'June', 'Esme', 'Tessa', 'Vera', 'Mira', 'Alice', 'Rosa', 'Ivy', 'Leah', 'Greta', 'Celia',
  'Owen', 'Silas', 'Elliot', 'Felix', 'Jonah', 'Miles', 'Arthur', 'Theo', 'Hugo', 'Simon', 'Caleb', 'Rowan', 'Isaac', 'Jasper', 'Leo', 'Victor', 'Ezra', 'Malcolm', 'Gideon', 'Abel'];
const EVERY_LAST = ['Holloway', 'Hart', 'Bennett', 'Ashford', 'Calloway', 'Whitlock', 'Mercer', 'Sutton', 'Fairfax', 'Lockwood', 'Ellery', 'Thorne', 'Winslow', 'Pembrook', 'Harrow', 'Quill',
  'Marsh', 'Crane', 'Vale', 'Dunmore', 'Ravel', 'Ashby', 'Kemp', 'Lowell', 'Prescott', 'Rourke', 'Sterling', 'Tanner', 'Wilder', 'Blackwood'];
const FAN_A = ['Tha', 'Ka', 'Ae', 'Bra', 'Ce', 'Da', 'Ela', 'Fi', 'Gal', 'Ha', 'Ily', 'Jo', 'Ky', 'Lo', 'Mi', 'Ne', 'Or', 'Pe', 'Ri', 'Sa', 'To', 'Va', 'Wy', 'Ze'];
const FAN_B = ['ran', 'dor', 'lia', 'ren', 'mir', 'wen', 'ric', 'nor', 'sha', 'vin', 'ra', 'lan', 'thas', 'dra', 'sel', 'mon', 'ris', 'gan'];
const FAN_S1 = ['Ash', 'Storm', 'Raven', 'Thorn', 'Oak', 'Frost', 'Night', 'Sun', 'Moon', 'Silver', 'Grey', 'Wolf', 'Brightwater', 'Red', 'Iron', 'Dawn', 'Hollow', 'Star'];
const FAN_S2 = ['vale', 'wood', 'song', 'crest', 'fall', 'shade', 'brook', 'wind', 'heart', 'bane', 'ford', 'hold', 'mere', 'ridge', 'thorn', 'field'];
const ELF_A = ['Ae', 'Ela', 'Ili', 'Lae', 'Syl', 'Thra', 'Cae', 'Fae', 'Ny', 'Ri', 'Gala', 'Ara', 'Eo', 'Lu', 'Mae', 'Thi'];
const ELF_B = ['la', 're', 'ri', 'tha', 'ndi', 'lo', 'ae', 'wy', 'ne', 'li', 'ra', 'sse'];
const ELF_C = ['iel', 'wen', 'ion', 'ith', 'as', 'ra', 'eth', 'ir', 'ael', 'ien', 'or', 'anna'];
const ELF_S1 = ['Moon', 'Star', 'Silver', 'Leaf', 'Dawn', 'Mist', 'Willow', 'Sky', 'Dew', 'Night', 'Sun', 'Gold'];
const ELF_S2 = ['whisper', 'song', 'shade', 'bloom', 'river', 'glade', 'veil', 'light', 'brook', 'petal', 'wind', 'dancer'];
const HARSH_A = ['Gr', 'Kr', 'Dr', 'Br', 'Z', 'Ug', 'Mor', 'Gor', 'Vr', 'Sk', 'Th', 'Bal', 'Rog', 'Nar'];
const HARSH_B = ['a', 'o', 'u', 'ak', 'ok', 'uk', 'aa', 'ug', 'ash', 'or'];
const HARSH_C = ['g', 'k', 'th', 'rn', 'sh', 'z', 'gar', 'dush', 'rok', 'kus', 'mak', 'goth', 'nak'];
const HARSH_S1 = ['Iron', 'Stone', 'Blood', 'Bone', 'Grim', 'Black', 'Rock', 'Ash', 'Skull', 'Dread', 'Rust', 'Storm'];
const HARSH_S2 = ['jaw', 'fist', 'hammer', 'maw', 'tooth', 'axe', 'beard', 'hide', 'breaker', 'helm', 'crusher', 'tusk'];
const NORD_M = ['Bjorn', 'Leif', 'Ragnar', 'Eirik', 'Torvald', 'Gunnar', 'Sten', 'Arne', 'Ivar', 'Knut', 'Halvard', 'Ulf', 'Sigurd', 'Orm', 'Hakon'];
const NORD_F = ['Sigrid', 'Astrid', 'Ingrid', 'Freya', 'Solveig', 'Halla', 'Ylva', 'Runa', 'Liv', 'Hilde', 'Gudrun', 'Thora', 'Ragna', 'Embla', 'Signe'];
const ANC_A = ['Aure', 'Cass', 'Luc', 'Maxim', 'Octav', 'Valer', 'Sever', 'Corn', 'Fab', 'Flav', 'Jul', 'Marc', 'Tib', 'Clod', 'Aemil', 'Serv'];
const ANC_B = ['ius', 'ia', 'us', 'a', 'ian', 'ina', 'ilia', 'ianus'];
const ANC_LAST = ['Varro', 'Maro', 'Sulla', 'Corvus', 'Crassus', 'Drusus', 'Aquila', 'Lentulus', 'Vitalis', 'Severus', 'Calvus', 'Rufus', 'Strabo', 'Galba', 'Naso'];
const SF_A = ['Ka', 'Ze', 'Ry', 'Vo', 'Ny', 'Ja', 'Tal', 'Ori', 'Xan', 'Lio', 'Dax', 'Sev', 'Ky', 'Ren', 'Ari', 'Quin'];
const SF_B = ['len', 'ra', 'x', 'n', 'ss', 'ko', 'ya', 'ris', 'ion', 'el', 'tek', 'ara'];
const SF_LAST = ['Voss', 'Kade', 'Orlov', 'Vance', 'Kestrel', 'Navarre', 'Sato', 'Okafor', 'Reyes', 'Lindqvist', 'Hale', 'Draven', 'Castellan', 'Ishikawa', 'Mbeki', 'Novak'];

export function makeName(style: NameStyle): string {
  switch (style) {
    case 'everyday': return `${pick(EVERY_FIRST)} ${pick(EVERY_LAST)}`;
    case 'fantasy': return `${pick(FAN_A)}${pick(FAN_B)} ${pick(FAN_S1)}${pick(FAN_S2)}`;
    case 'elvish': return `${pick(ELF_A)}${Math.random() < 0.5 ? pick(ELF_B) : ''}${pick(ELF_C)} ${pick(ELF_S1)}${pick(ELF_S2)}`;
    case 'harsh': { const n = cap(`${pick(HARSH_A)}${pick(HARSH_B)}${pick(HARSH_C)}`.toLowerCase()); return `${n} ${pick(HARSH_S1)}${pick(HARSH_S2)}`; }
    case 'nordic': { const f = Math.random() < 0.5; return `${pick(f ? NORD_F : NORD_M)} ${pick(NORD_M)}${f ? 'sdottir' : 'sson'}`; }
    case 'ancient': return `${pick(ANC_A)}${pick(ANC_B)} ${pick(ANC_LAST)}`;
    case 'scifi': return `${pick(SF_A)}${pick(SF_B)} ${pick(SF_LAST)}`;
  }
}

const KEY = 'writell.nameStyle';
export const getNameStyle = (): NameStyle => { try { const v = localStorage.getItem(KEY); if (NAME_STYLES.some((s) => s.id === v)) return v as NameStyle; } catch { /* */ } return 'fantasy'; };
export const setNameStyle = (s: NameStyle) => { try { localStorage.setItem(KEY, s); } catch { /* */ } };
