// The city switch: one action that changes mode, deals fresh packing and
// landing checklists, and can print or export everything that follows from it.
// Used by the web app and by cli/switch.mjs.
import { CITIES, WEEKDAYS, addDays, addMinutes, fmtDay, isoWeekday, otherCity } from './dates.ts';
import type { City, Day } from './dates.ts';
import { writeIcs } from './ics.ts';
import type { IcsOutEvent } from './ics.ts';
import { WHEN_LABEL, WHEN_OFFSET } from './model.ts';
import type { Checklist, Doc, Profile, RoutineBlock, TemplateItem } from './model.ts';

/** How many old checklists are kept. */
export const HISTORY_LIMIT = 24;

export function makeChecklist(city: City, kind: Checklist['kind'], template: TemplateItem[], today: Day, serial: number): Checklist {
  return {
    id: `${kind}-${city}-${today}-${serial}`,
    city,
    kind,
    createdOn: today,
    items: template.filter((t) => t.text.trim()).map((t) => ({ id: t.id, text: t.text, ...(t.when ? { when: t.when } : {}), done: false })),
    archived: false,
  };
}

/**
 * Flip to a city. Sets the mode and date, archives the open checklists and
 * deals a fresh packing list (for the journey to that city) and landing list.
 * Flipping to the city you are already in deals fresh lists too.
 */
export function flip(doc: Doc, city: City, today: Day): Doc {
  const profile = doc.profiles[city];
  const serial = doc.checklists.length;
  const fresh = [makeChecklist(city, 'packing', profile.packing, today, serial), makeChecklist(city, 'landing', profile.landing, today, serial + 1)];
  const history = doc.checklists.map((c) => ({ ...c, archived: true })).slice(-(HISTORY_LIMIT - fresh.length));
  return { ...doc, mode: city, switchedOn: today, checklists: [...history, ...fresh], dismissedSuggestion: null };
}

export const openChecklists = (doc: Doc): Checklist[] => doc.checklists.filter((c) => !c.archived);

/** The routine blocks that run on a date, in the profile's order. */
export const planFor = (profile: Profile, day: Day): RoutineBlock[] => profile.routine.filter((b) => b.days.includes(isoWeekday(day)));

export const daysText = (days: number[]): string => {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Weekdays';
  if (d.join() === '6,7') return 'Weekends';
  return d.map((n) => WEEKDAYS[n - 1]).join(', ') || 'Never';
};

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** One weekly recurring event per routine block, in the city's timezone, starting on or after `from`. */
export function routineEvents(profile: Profile, city: City, from: Day): IcsOutEvent[] {
  const events: IcsOutEvent[] = [];
  for (const b of profile.routine) {
    const days = [...new Set(b.days)].filter((d) => d >= 1 && d <= 7).sort((x, y) => x - y);
    if (!days.length || !/^\d{2}:\d{2}$/.test(b.start)) continue;
    let first = from;
    while (!days.includes(isoWeekday(first))) first = addDays(first, 1);
    events.push({
      uid: `routine-${city}-${b.id}@two-city`,
      summary: b.label,
      description: `${CITIES[city].label} routine`,
      start: { date: first, time: b.start, tzid: CITIES[city].tz },
      durationMin: b.minutes,
      rrule: `FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d - 1]).join(',')}`,
    });
  }
  return events;
}

/** The "calendar template": the city's routine as an .ics of weekly events. */
export const routineIcs = (profile: Profile, city: City, from: Day, stamp: string): string =>
  writeIcs(routineEvents(profile, city, from), { name: `${CITIES[city].label} routine`, stamp });

const blockLine = (b: RoutineBlock) => `${b.start}-${addMinutes(b.start, b.minutes)}  ${b.label}`;

/** Packing and landing lists as Markdown task lists, with the routine and defaults for reference. */
export function checklistMarkdown(doc: Doc, city: City, today: Day): string {
  const profile = doc.profiles[city];
  const lists = openChecklists(doc).filter((c) => c.city === city);
  const out: string[] = [`# ${CITIES[city].label}: switch on ${fmtDay(today)}`, ''];
  for (const kind of ['packing', 'landing'] as const) {
    const list = lists.find((c) => c.kind === kind);
    out.push(kind === 'packing' ? `## Packing for ${CITIES[city].label}` : '## Landing', '');
    if (!list || !list.items.length) out.push('Nothing on this list yet.', '');
    else {
      for (const it of list.items) {
        const due = kind === 'landing' && it.when ? ` (${WHEN_LABEL[it.when].toLowerCase()}, ${fmtDay(addDays(list.createdOn, WHEN_OFFSET[it.when]), { year: false })})` : '';
        out.push(`- [${it.done ? 'x' : ' '}] ${it.text}${due}`);
      }
      out.push('');
    }
  }
  out.push('## Defaults', '', `- Court: ${placeText(profile.court)}`, `- Gym: ${placeText(profile.gym)}`);
  for (const d of profile.defaults) if (d.key.trim()) out.push(`- ${d.key}: ${d.value || 'not set'}`);
  out.push('', '## Routine', '');
  for (const b of profile.routine) out.push(`1. ${blockLine(b)} (${daysText(b.days)})`);
  return out.join('\n') + '\n';
}

export const placeText = (p: { name: string; slot: string }): string => (p.name.trim() ? `${p.name.trim()}${p.slot.trim() ? `, ${p.slot.trim()}` : ''}` : 'not set');

/** Plain-text summary for the terminal. */
export function switchSummary(doc: Doc, city: City, today: Day): string {
  const profile = doc.profiles[city];
  const out: string[] = [`${CITIES[city].label} mode, switched on ${fmtDay(today)}`, ''];
  out.push('Routine order');
  const todays = new Set(planFor(profile, today).map((b) => b.id));
  profile.routine.forEach((b, i) => out.push(`  ${String(i + 1).padStart(2)}. ${blockLine(b)}  [${daysText(b.days)}]${todays.has(b.id) ? '  today' : ''}`));
  if (!profile.routine.length) out.push('  (no routine set)');
  out.push('', 'Defaults', `  Court: ${placeText(profile.court)}`, `  Gym:   ${placeText(profile.gym)}`);
  for (const d of profile.defaults) if (d.key.trim()) out.push(`  ${d.key}: ${d.value || 'not set'}`);
  for (const list of openChecklists(doc).filter((c) => c.city === city)) {
    out.push('', list.kind === 'packing' ? `Packing for ${CITIES[city].label}` : 'Landing');
    for (const it of list.items) out.push(`  [ ] ${it.text}${it.when ? `  (${WHEN_LABEL[it.when].toLowerCase()})` : ''}`);
    if (!list.items.length) out.push('  (empty)');
  }
  return out.join('\n');
}

export interface Suggestion {
  city: City;
  stayId: string;
  arrive: Day;
  /** 'today', 'tomorrow', or 'under way' when the stay has already started. */
  when: 'today' | 'tomorrow' | 'under way';
}

/** Offer the flip when the ledger has a stay in the other city starting today or tomorrow, or already under way. */
export function suggestSwitch(doc: Doc, today: Day): Suggestion | null {
  const city = otherCity(doc.mode);
  const tomorrow = addDays(today, 1);
  const stays = doc.stays.filter((s) => s.city === city && s.arrive <= tomorrow && (s.depart === null || s.depart > today));
  const stay = stays.sort((a, b) => b.arrive.localeCompare(a.arrive))[0];
  if (!stay || stay.id === doc.dismissedSuggestion) return null;
  // The mode was set by hand after this stay began: respect it.
  if (doc.switchedOn && doc.switchedOn >= stay.arrive) return null;
  // An open-ended stay that a later stay elsewhere has superseded is not "under way".
  if (stay.depart === null && doc.stays.some((s) => s.arrive > stay.arrive && s.arrive <= today)) return null;
  return { city, stayId: stay.id, arrive: stay.arrive, when: stay.arrive === tomorrow ? 'tomorrow' : stay.arrive === today ? 'today' : 'under way' };
}
