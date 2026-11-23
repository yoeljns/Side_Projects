// Tokenising for search and similarity. Pure.

/**
 * Lower-cases and strips diacritics so that 'İstanbul', 'Istanbul' and 'istanbul' meet, and so that
 * Turkish typed on an English keyboard ('dongu') matches the proper spelling ('döngü').
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');
}

const EN_STOP = `a about above after again against all also am an and any are as at be because been before
being below between both but by can cannot could did do does doing down during each either few for from further
had has have having he her here hers herself him himself his how however i if in into is it its itself just
may me might more most much must my myself no nor not now of off on once one only or other our ours ourselves
out over own rather same shall she should so some such than that the their theirs them themselves then there
these they this those through to too under until up upon us very was we were what when where whether which
while who whom why will with within without would yet you your yours yourself yourselves see also note notes
get got gets like one two three many often still even ever never always every something nothing thing things
make makes made way ways much more less lot bit new old use used using`;

// Written folded (no diacritics, dotless i as i), because stop words are checked after folding.
const TR_STOP = `acaba ama ancak artik aslinda ayni az bazi belki ben beni benim beri bile bir biraz bircok biri
birkac birsey biz bize bizi bizim boyle bu buna bunda bundan bunlar bunu bunun burada cok cunku da daha de degil
diger diye dolayi en fakat gibi gore hala hangi hem henuz hep hepsi her herhangi hic icin ile ise iste kadar ki
kim kimse mi mu nasil ne neden nedeniyle nerede nicin niye o olan olarak oldu oldugu olmak olmasi olsa olur on
ona ondan onlar onlari onu onun orada oysa pek sadece sanki sen siz sonra su suna sunu tum uzere var ve veya
ya yani yine yok zaten once icinde uzerine arasinda karsi hatta ya da yada yoluyla bak olunca`;

export const STOP_WORDS: ReadonlySet<string> = new Set(`${EN_STOP} ${TR_STOP}`.split(/\s+/).filter(Boolean));

/**
 * The 'S' stemmer (Harman 1991): folds English plurals onto singulars and nothing else, so 'cycles'
 * meets 'cycle' and 'economies' meets 'economy' without the over-merging of a full stemmer.
 * Turkish words are left as written (see the README for why).
 */
export function stem(word: string): string {
  if (word.length <= 3 || !/^[a-z]+$/.test(word)) return word;
  if (word.endsWith('ies') && !word.endsWith('eies') && !word.endsWith('aies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('es') && !word.endsWith('aes') && !word.endsWith('ees') && !word.endsWith('oes')) {
    return word.slice(0, -1);
  }
  if (word.endsWith('s') && !word.endsWith('us') && !word.endsWith('ss') && !word.endsWith('is')) {
    return word.slice(0, -1);
  }
  return word;
}

export interface RawToken {
  /** Folded form, not stemmed, not stop-filtered. */
  t: string;
  /** Offsets into the string that was tokenised. */
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}]+(?:[’'][\p{L}]+)?/gu;

/** Every word with its offsets. An apostrophe suffix ("Minsky'nin", "neighbour's") is dropped. */
export function rawTokens(text: string): RawToken[] {
  const out: RawToken[] = [];
  for (const m of text.matchAll(WORD)) {
    const whole = m[0];
    const cut = whole.search(/[’']/);
    const word = cut === -1 ? whole : whole.slice(0, cut);
    out.push({ t: fold(word), start: m.index, end: m.index + word.length });
  }
  return out;
}

export interface Term {
  /** Stemmed, folded form used for matching. */
  stem: string;
  /** Lower-cased word as written, kept so reports can show 'döngü' rather than 'dongu'. */
  surface: string;
}

function keep(folded: string): boolean {
  if (folded.length < 2) return false;
  if (/^\d+$/.test(folded)) return folded.length === 4; // keep years, drop other numbers
  return !STOP_WORDS.has(folded);
}

/** Content terms of a text: folded, stop words removed, English plurals stemmed. */
export function terms(text: string): Term[] {
  const out: Term[] = [];
  for (const tok of rawTokens(text)) {
    if (!keep(tok.t)) continue;
    const s = stem(tok.t);
    if (STOP_WORDS.has(s)) continue;
    out.push({ stem: s, surface: lowerSurface(text.slice(tok.start, tok.end)) });
  }
  return out;
}

export function lowerSurface(word: string): string {
  // Turkish capitals lower-case differently (I -> ı, İ -> i); only apply that when the word has Turkish letters.
  return /[çğıöşüÇĞİÖŞÜ]/.test(word) ? word.toLocaleLowerCase('tr-TR') : word.toLowerCase();
}

export function stems(text: string): string[] {
  return terms(text).map((t) => t.stem);
}

export function countStems(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of stems(text)) counts.set(s, (counts.get(s) ?? 0) + 1);
  return counts;
}
