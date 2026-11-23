// Shapes: this app's own document, and the parts of the other apps' documents it reads.
import type { ISODate } from './dates';
import type { Birthday } from './window';

export type SectionId = 'trips' | 'matches' | 'games' | 'books' | 'builds' | 'hours' | 'decisions';
export const SECTION_IDS: SectionId[] = ['trips', 'matches', 'games', 'books', 'builds', 'hours', 'decisions'];
export const SECTION_LABEL: Record<SectionId, string> = {
  trips: 'Trips',
  matches: 'Matches',
  games: 'Games played',
  books: 'Books',
  builds: 'Builds shipped',
  hours: 'Hours',
  decisions: 'Decisions',
};

// --- other apps (see the cross-app contracts in the README) ---
export interface Stay {
  id: string;
  city: string;
  country: string;
  arrive: ISODate;
  depart: ISODate | null;
  note?: string;
}
export interface Fixture {
  id: string;
  date: ISODate;
  opponent: string;
  home: boolean;
  competition: string;
  venue?: string;
  attended?: boolean;
}
export interface HoursEntry {
  id: string;
  day: ISODate;
  category: string;
  minutes: number;
}
export interface HoursCategory {
  id: string;
  label: string;
  weeklyTargetHours?: number;
}
export interface Decision {
  id: string;
  title: string;
  category: string;
  madeOn: ISODate;
  probability: number;
  reviewOn?: ISODate;
  outcome?: boolean;
  resolvedOn?: ISODate;
}

export type SourceVia = 'file' | 'sync';
export interface Imported<T> {
  importedAt: number;
  via: SourceVia;
  data: T;
}
export interface TwoCityData { stays: Stay[]; fixtures: Fixture[] }
export interface HoursData { entries: HoursEntry[]; categories: HoursCategory[] }
export interface DecisionData { decisions: Decision[] }

// --- kept in this app ---
export interface Question {
  id: string;
  text: string;
  sections: SectionId[];
}
export interface Book {
  id: string;
  title: string;
  author: string;
  finished?: ISODate;
  rating?: number; // 0.25 steps up to 5; absent = not rated
  pages?: number;
  note?: string;
}
export interface Build {
  id: string;
  name: string;
  shipped: ISODate;
  link?: string;
  note?: string;
}
/** A hand-kept tally for games with no feed (backgammon matches, say). */
export interface Counter {
  id: string;
  label: string;
  byYear: Record<string, { played: number; won: number }>;
}
export interface ChessGame {
  id: string; // 'lichess:abcd1234' | 'chesscom:<uuid or url tail>'
  site: 'lichess' | 'chesscom';
  at: number; // ms since epoch, UTC
  speed: string; // bullet | blitz | rapid | classical | daily | …
  rated: boolean;
  color: 'w' | 'b';
  result: 'win' | 'draw' | 'loss';
  opp: string;
  oppRating?: number;
  /** Own rating going into the game (Lichess only). */
  before?: number;
  /** Own rating after the game. */
  after?: number;
  url: string;
}
export interface ChessCache {
  fetchedAt: number;
  /** One line per account that was fetched or failed. */
  notes: string[];
  games: ChessGame[];
}
export interface FolderSummary {
  name: string;
  commits: number;
  /** Date of the earliest commit touching the folder inside the window. */
  first?: ISODate;
  /** True when no commit touched the folder before the window opened. */
  isNew: boolean;
}
export interface RepoSummary {
  repo: string; // owner/name
  fetchedAt: number;
  total: number;
  /** True when the page cap was reached and the counts are a floor. */
  truncated: boolean;
  byMonth: Record<string, number>;
  folders: FolderSummary[];
}

export interface Doc {
  birthday: Birthday | null;
  questions: Question[];
  /** answers[yearKey][questionId] */
  answers: Record<string, Record<string, string>>;
  books: Book[];
  builds: Build[];
  counters: Counter[];
  chess: { lichess: string; chesscom: string; cache: Record<string, ChessCache> };
  /** cache[yearKey][repo] */
  github: { repos: string[]; cache: Record<string, Record<string, RepoSummary>> };
  imported: {
    twoCity?: Imported<TwoCityData>;
    hours?: Imported<HoursData>;
    decisions?: Imported<DecisionData>;
  };
}
