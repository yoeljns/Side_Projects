// "What matters next" for the Today tab: the few things across the ledger,
// matchday and trips that need attention, in date order.
import { CITIES, daysBetween, fmtDay, isCity } from './dates.ts';
import type { Day } from './dates.ts';
import { evaluateAll, periodLabel, plannedStays, stayOutlook } from './ledger.ts';
import { canAttend, fixtureTitle, saleAlerts } from './matchday.ts';
import type { Doc } from './model.ts';
import { STATUS_LABEL, whatMattersNext } from './triggers.ts';

export interface NextItem {
  area: 'ledger' | 'matchday' | 'trips';
  /** Sort key; null sorts first (needs attention now). */
  date: Day | null;
  text: string;
  tone: 'bad' | 'warn' | 'plain';
}

const cityLabel = (city: string) => (isCity(city) ? CITIES[city].label : city.replace(/(^|-)([a-z])/g, (_, sep: string, ch: string) => (sep ? ' ' : '') + ch.toUpperCase()));

/** Days-left level at which a rule is worth a line on the Today tab. */
export const TIGHT_DAYS = 14;

export function whatsNext(doc: Doc, today: Day): NextItem[] {
  const out: NextItem[] = [];

  // Ledger: limits, then the next flight.
  for (const s of evaluateAll(doc.rules, doc.stays, today)) {
    if (s.remaining === null) continue;
    const where = `${s.rule.label} (${periodLabel(s.rule, s.period)})`;
    if (s.breached) out.push({ area: 'ledger', date: null, text: `${where}: ${-s.remaining} ${-s.remaining === 1 ? 'day' : 'days'} over the limit with what is booked.`, tone: 'bad' });
    else if (s.remaining <= TIGHT_DAYS) out.push({ area: 'ledger', date: null, text: `${where}: ${s.remaining} ${s.remaining === 1 ? 'day' : 'days'} left after what is booked.`, tone: 'warn' });
  }
  const planned = plannedStays(doc.stays, today);
  for (const stay of planned) {
    if (stay.arrive > today && stayOutlook(stay, doc.stays, doc.rules, today).breach) {
      out.push({ area: 'ledger', date: stay.arrive, text: `The ${cityLabel(stay.city)} stay from ${fmtDay(stay.arrive, { weekday: false })} goes over a limit.`, tone: 'bad' });
    }
  }
  const nextArrival = planned.find((s) => s.arrive > today);
  if (nextArrival) out.push({ area: 'ledger', date: nextArrival.arrive, text: `Fly to ${cityLabel(nextArrival.city)} on ${fmtDay(nextArrival.arrive)}.`, tone: 'plain' });
  const current = planned.find((s) => s.arrive <= today && s.depart !== null);
  if (current && current.depart && (!nextArrival || current.depart < nextArrival.arrive)) {
    out.push({ area: 'ledger', date: current.depart, text: `Leave ${cityLabel(current.city)} on ${fmtDay(current.depart)}.`, tone: 'plain' });
  }

  // Matchday: sale windows, then the next match you can get to.
  for (const a of saleAlerts(doc.fixtures, doc.stays, doc.sale, today)) {
    const est = a.window.confirmed ? '' : ' (estimated date)';
    out.push({
      area: 'matchday',
      date: a.state === 'open-now' ? null : a.window.opens,
      text: a.state === 'open-now' ? `Tickets should be on sale for ${fixtureTitle(a.fixture)}, ${fmtDay(a.fixture.date, { year: false })}${est}.` : `Tickets for ${fixtureTitle(a.fixture)} go on sale ${fmtDay(a.window.opens, { year: false })}${est}.`,
      tone: 'warn',
    });
  }
  const nextMatch = [...doc.fixtures].sort((a, b) => a.date.localeCompare(b.date)).find((f) => f.date >= today && canAttend(f, doc.stays));
  if (nextMatch) out.push({ area: 'matchday', date: nextMatch.date, text: `${fixtureTitle(nextMatch)}, ${nextMatch.competition}: you are in London.`, tone: 'plain' });

  // Trips.
  for (const s of whatMattersNext(doc.trips, today)) {
    if (s.status === 'waiting' && (!s.date || daysBetween(today, s.date) > 60)) continue;
    out.push({
      area: 'trips',
      date: s.status === 'fired' || s.status === 'open-now' || s.status === 'missed' ? null : s.date,
      text: `${s.tripName || 'Trip'}: ${s.trigger.label}. ${STATUS_LABEL[s.status]}. ${s.detail}`,
      tone: s.status === 'missed' ? 'bad' : s.status === 'waiting' ? 'plain' : 'warn',
    });
  }

  // Undated items need attention now and sort first.
  return out.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

export { cityLabel };
