// The app's single document and its neutral starter content. Shared by the web
// app and the CLI, so nothing here touches the DOM.
import type { City, Day } from './dates.ts';
import { RULE_PRESETS } from './ledger.ts';
import type { Rule, Stay } from './ledger.ts';
import { DEFAULT_SALE } from './matchday.ts';
import type { Fixture, SaleSettings } from './matchday.ts';
import type { Trip } from './triggers.ts';

export interface RoutineBlock {
  id: string;
  label: string;
  /** 'HH:MM' local to the city. */
  start: string;
  minutes: number;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days: number[];
}

/** When a landing item is due, counted from the day of the switch. */
export type When = 'landing' | 'first-morning' | 'first-week';
export const WHEN_LABEL: Record<When, string> = { landing: 'On landing', 'first-morning': 'First morning', 'first-week': 'First week' };
export const WHEN_OFFSET: Record<When, number> = { landing: 0, 'first-morning': 1, 'first-week': 7 };

export interface TemplateItem {
  id: string;
  text: string;
  when?: When;
}

export interface Profile {
  /** In the order the day should run. */
  routine: RoutineBlock[];
  court: { name: string; slot: string };
  gym: { name: string; slot: string };
  /** What to pack for the journey to this city. */
  packing: TemplateItem[];
  landing: TemplateItem[];
  defaults: { id: string; key: string; value: string }[];
}

export interface Checklist {
  id: string;
  city: City;
  kind: 'packing' | 'landing';
  createdOn: Day;
  items: { id: string; text: string; when?: When; done: boolean }[];
  /** Older lists are kept as history. */
  archived: boolean;
}

export interface Doc {
  mode: City;
  switchedOn: Day | null;
  profiles: Record<City, Profile>;
  checklists: Checklist[];
  /** Id of the stay whose "switch?" prompt was dismissed. */
  dismissedSuggestion: string | null;
  stays: Stay[];
  rules: Rule[];
  fixtures: Fixture[];
  fixturesLoadedAt: string | null;
  sale: SaleSettings;
  trips: Trip[];
  updatedAt?: number;
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const DAILY = [1, 2, 3, 4, 5, 6, 7];

const block = (id: string, label: string, start: string, minutes: number, days: number[]): RoutineBlock => ({ id, label, start, minutes, days });
const item = (id: string, text: string, when?: When): TemplateItem => (when ? { id, text, when } : { id, text });

/** Generic starting points. Everything is meant to be edited in Settings. */
export function starterProfiles(): Record<City, Profile> {
  return {
    london: {
      routine: [
        block('l1', 'Morning walk', '07:00', 30, DAILY),
        block('l2', 'Deep work', '08:00', 180, WEEKDAYS),
        block('l3', 'Gym', '12:30', 60, [1, 3, 5]),
        block('l4', 'Calls and admin', '14:00', 180, WEEKDAYS),
        block('l5', 'Court', '18:30', 90, [2, 4]),
        block('l6', 'Study', '20:30', 90, [1, 2, 3, 4]),
        block('l7', 'Weekly review', '10:00', 60, [7]),
      ],
      court: { name: '', slot: '' },
      gym: { name: '', slot: '' },
      packing: [
        item('lp1', 'Passport and residence documents'),
        item('lp2', 'Laptop, charger, UK plug adaptor'),
        item('lp3', 'Phone, UK SIM or eSIM ready'),
        item('lp4', 'Rackets and training kit'),
        item('lp5', 'Study materials'),
        item('lp6', 'Waterproof jacket'),
        item('lp7', 'Medication and prescriptions'),
        item('lp8', 'House keys'),
      ],
      landing: [
        item('ll1', 'Switch phone to the UK SIM', 'landing'),
        item('ll2', 'Check the travel card has credit', 'landing'),
        item('ll3', 'Food shop', 'first-morning'),
        item('ll4', 'Book courts for the week', 'first-morning'),
        item('ll5', 'Import this city’s routine into the calendar', 'first-morning'),
        item('ll6', 'Check the next ticket sale windows', 'first-week'),
        item('ll7', 'Post and deliveries that arrived while away', 'first-week'),
      ],
      defaults: [
        { id: 'ld1', key: 'Currency', value: 'GBP' },
        { id: 'ld2', key: 'Transport card', value: '' },
        { id: 'ld3', key: 'SIM', value: '' },
        { id: 'ld4', key: 'Plug', value: 'Type G' },
      ],
    },
    istanbul: {
      routine: [
        block('i1', 'Deep work', '08:30', 180, WEEKDAYS),
        block('i2', 'Court', '12:00', 90, [2, 4, 6]),
        block('i3', 'Calls and admin', '14:30', 180, WEEKDAYS),
        block('i4', 'Gym', '18:00', 60, [1, 3, 5]),
        block('i5', 'Evening walk', '19:30', 30, DAILY),
        block('i6', 'Study', '21:00', 90, [1, 2, 3, 4]),
        block('i7', 'Weekly review', '11:00', 60, [7]),
      ],
      court: { name: '', slot: '' },
      gym: { name: '', slot: '' },
      packing: [
        item('ip1', 'Passport and ID card'),
        item('ip2', 'Laptop, charger, European plug adaptor'),
        item('ip3', 'Phone, Turkish SIM or eSIM ready'),
        item('ip4', 'Rackets and training kit'),
        item('ip5', 'Study materials'),
        item('ip6', 'Medication and prescriptions'),
        item('ip7', 'House keys'),
      ],
      landing: [
        item('il1', 'Switch phone to the Turkish SIM', 'landing'),
        item('il2', 'Check the travel card has credit', 'landing'),
        item('il3', 'Food shop', 'first-morning'),
        item('il4', 'Book courts for the week', 'first-morning'),
        item('il5', 'Import this city’s routine into the calendar', 'first-morning'),
        item('il6', 'Company paperwork that needs a signature in person', 'first-week'),
      ],
      defaults: [
        { id: 'id1', key: 'Currency', value: 'TRY' },
        { id: 'id2', key: 'Transport card', value: '' },
        { id: 'id3', key: 'SIM', value: '' },
        { id: 'id4', key: 'Plug', value: 'Type F' },
      ],
    },
  };
}

export function blankDoc(): Doc {
  return {
    mode: 'london',
    switchedOn: null,
    profiles: starterProfiles(),
    checklists: [],
    dismissedSuggestion: null,
    stays: [],
    rules: RULE_PRESETS.map((r) => ({ ...r, countries: [...r.countries] })),
    fixtures: [],
    fixturesLoadedAt: null,
    sale: structuredClone(DEFAULT_SALE),
    trips: [],
  };
}

/** Fill gaps in a document read from a file or from sync, so older or partial copies still work. */
export function normaliseDoc(raw: unknown): Doc {
  const blank = blankDoc();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return blank;
  const d = { ...blank, ...(raw as Partial<Doc>) };
  const profiles = (d.profiles ?? {}) as Partial<Record<City, Partial<Profile>>>;
  d.profiles = {
    london: { ...blank.profiles.london, ...(profiles.london ?? {}) },
    istanbul: { ...blank.profiles.istanbul, ...(profiles.istanbul ?? {}) },
  };
  d.mode = d.mode === 'istanbul' ? 'istanbul' : 'london';
  for (const k of ['checklists', 'stays', 'rules', 'fixtures', 'trips'] as const) if (!Array.isArray(d[k])) (d[k] as unknown[]) = blank[k];
  d.sale = { ...blank.sale, ...(d.sale ?? {}), offsets: { ...blank.sale.offsets, ...(d.sale?.offsets ?? {}) } };
  return d;
}
