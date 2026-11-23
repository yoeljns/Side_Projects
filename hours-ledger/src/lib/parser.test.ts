import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, type Category } from './model';
import { matchCategory, parseDayWord, parseDuration, parseDurationText, parseLine } from './parser';

// Monday 23 Nov 2026 would hide weekday edge cases, so most tests sit on Wednesday the 18th.
const WED = '2026-11-18';
const cats = DEFAULT_CATEGORIES;
const p = (s: string, today = WED, c: Category[] = cats) => parseLine(s, c, today);
const msg = (s: string, today = WED, c: Category[] = cats) => {
  const r = parseLine(s, c, today);
  if (r.ok) throw new Error(`expected "${s}" to fail`);
  return r.message;
};

describe('durations', () => {
  it.each([
    ['1h', 60],
    ['2hrs', 120],
    ['1hour', 60],
    ['1h30', 90],
    ['1h30m', 90],
    ['1h5', 65],
    ['1.5h', 90],
    ['1,5h', 90],
    ['.5h', 30],
    ['0.25h', 15],
    ['1.25h', 75],
    ['45m', 45],
    ['90min', 90],
    ['20mins', 20],
    ['1:30', 90],
    ['0:45', 45],
    ['2H', 120],
  ])('%s is %i minutes', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it.each(['45', 'h', 'm', '1:75', 'masters', '1h30s', '-1h', '1.5', '2026-11-18'])('%s is not a duration', (text) => {
    expect(parseDuration(text)).toBeNull();
  });

  it('takes a bare number as minutes only when asked', () => {
    expect(parseDuration('45', true)).toBe(45);
    expect(parseDurationText('45', true)).toBe(45);
    expect(parseDurationText('1h 30m', true)).toBe(90);
    expect(parseDurationText('1h 30', true)).toBeNull(); // bare only when it stands alone
    expect(parseDurationText('', true)).toBeNull();
    expect(parseDurationText('soon', true)).toBeNull();
  });
});

describe('day words', () => {
  it('resolves today and yesterday', () => {
    expect(parseDayWord('today', WED)).toBe('2026-11-18');
    expect(parseDayWord('yesterday', WED)).toBe('2026-11-17');
    expect(parseDayWord('yest', '2026-11-23')).toBe('2026-11-22'); // back across the week boundary
  });

  it('takes a weekday as the most recent one that is not in the future', () => {
    expect(parseDayWord('mon', WED)).toBe('2026-11-16');
    expect(parseDayWord('Tuesday', WED)).toBe('2026-11-17');
    expect(parseDayWord('wed', WED)).toBe('2026-11-18'); // today
    expect(parseDayWord('thu', WED)).toBe('2026-11-12'); // last week's
    expect(parseDayWord('sun', WED)).toBe('2026-11-15');
    expect(parseDayWord('thurs', WED)).toBe('2026-11-12');
  });

  it('takes full dates but not future ones', () => {
    expect(parseDayWord('2026-11-02', WED)).toBe('2026-11-02');
    expect(parseDayWord('2026-11-19', WED)).toBe('future');
    expect(parseDayWord('tomorrow', WED)).toBe('future');
    expect(parseDayWord('2026-13-01', WED)).toBeNull();
    expect(parseDayWord('reading', WED)).toBeNull();
    expect(parseDayWord('mo', WED)).toBeNull();
  });
});

describe('category matching', () => {
  it('matches by exact name, prefix, id and alias', () => {
    const withAlias = cats.map((c) => (c.id === 'training' ? { ...c, aliases: ['gym', 'tennis'] } : c));
    expect(matchCategory('Masters', cats)).toMatchObject({ kind: 'one', category: { id: 'masters' } });
    expect(matchCategory('mas', cats)).toMatchObject({ kind: 'one', category: { id: 'masters' } });
    expect(matchCategory('b', cats)).toMatchObject({ kind: 'one', category: { id: 'builds' } });
    expect(matchCategory('gym', withAlias)).toMatchObject({ kind: 'one', category: { id: 'training' } });
    expect(matchCategory('ten', withAlias)).toMatchObject({ kind: 'one', category: { id: 'training' } });
    expect(matchCategory('xyz', cats)).toEqual({ kind: 'none' });
  });

  it('reports ambiguity, prefers an exact match, and ignores archived categories', () => {
    const more: Category[] = [...cats, { id: 'travel', label: 'Travel', color: 4 }, { id: 'comp', label: 'Comp', color: 5 }];
    const t = matchCategory('tr', more);
    expect(t.kind === 'many' && t.categories.map((c) => c.id)).toEqual(['training', 'travel']);
    expect(matchCategory('comp', more)).toMatchObject({ kind: 'one', category: { id: 'comp' } }); // exact beats the prefix of Company
    expect(matchCategory('compa', more)).toMatchObject({ kind: 'one', category: { id: 'company' } });
    const archived = more.map((c) => (c.id === 'travel' ? { ...c, archived: true } : c));
    expect(matchCategory('tr', archived)).toMatchObject({ kind: 'one', category: { id: 'training' } });
  });

  it('matches multi-word labels by first word or run together', () => {
    const c: Category[] = [{ id: 'deep-work', label: 'Deep work', color: 0 }];
    expect(matchCategory('deep', c).kind).toBe('one');
    expect(matchCategory('deepwork', c).kind).toBe('one');
    expect(matchCategory('work', c).kind).toBe('none');
  });
});

describe('quick line', () => {
  it('parses the four examples from the brief', () => {
    expect(p('masters 1h30 reading')).toEqual({ ok: true, category: 'masters', day: WED, minutes: 90, note: 'reading' });
    expect(p('company 45m')).toEqual({ ok: true, category: 'company', day: WED, minutes: 45 });
    expect(p('2h builds yesterday')).toEqual({ ok: true, category: 'builds', day: '2026-11-17', minutes: 120 });
    expect(p('training 1.5h mon')).toEqual({ ok: true, category: 'training', day: '2026-11-16', minutes: 90 });
  });

  it('accepts any order at the start, prefixes and odd spacing or case', () => {
    expect(p('  yesterday   MAS  1h  ')).toEqual({ ok: true, category: 'masters', day: '2026-11-17', minutes: 60 });
    expect(p('45m c')).toEqual({ ok: true, category: 'company', day: WED, minutes: 45 });
    expect(p('tue 1:15 tr legs')).toEqual({ ok: true, category: 'training', day: '2026-11-17', minutes: 75, note: 'legs' });
  });

  it('adds up separate hour and minute tokens', () => {
    expect(p('masters 1h 30m seminar')).toMatchObject({ minutes: 90, note: 'seminar' });
    expect(p('1h builds 20m')).toMatchObject({ category: 'builds', minutes: 80 });
  });

  it('takes a day word at the very end, after the note', () => {
    expect(p('masters 1h30 reading yesterday')).toEqual({ ok: true, category: 'masters', day: '2026-11-17', minutes: 90, note: 'reading' });
    expect(p('company 2h board prep 2026-11-10')).toEqual({ ok: true, category: 'company', day: '2026-11-10', minutes: 120, note: 'board prep' });
  });

  it('leaves day and category words inside the note alone', () => {
    // "sun" is not at the start or the end, so it stays in the note.
    expect(p('masters 1h reading sun tzu')).toEqual({ ok: true, category: 'masters', day: WED, minutes: 60, note: 'reading sun tzu' });
    // A second category word, a second day and a number are all note once the head is done.
    expect(p('company 1h masters admin call')).toMatchObject({ category: 'company', note: 'masters admin call' });
    expect(p('mon company 1h tue planning notes')).toMatchObject({ day: '2026-11-16', note: 'tue planning notes' });
    expect(p('masters 1h 3 chapters')).toMatchObject({ minutes: 60, note: '3 chapters' });
    // A duration later in the note is not added on.
    expect(p('masters 1h read for 30m')).toMatchObject({ minutes: 60, note: 'read for 30m' });
  });

  it('uses aliases', () => {
    const c = cats.map((x) => (x.id === 'training' ? { ...x, aliases: ['gym'] } : x));
    expect(p('gym 1h legs', WED, c)).toEqual({ ok: true, category: 'training', day: WED, minutes: 60, note: 'legs' });
  });

  it('says what is missing', () => {
    expect(msg('')).toMatch(/Type a category and a duration/);
    expect(msg('masters')).toBe('How long? Add a duration such as 45m, 1h30 or 1.5h after "masters".');
    expect(msg('masters reading')).toMatch(/^How long\?/);
    expect(msg('1h30')).toBe('Which category? Add Company, Masters, Training or Builds.');
    expect(msg('1h yesterday')).toMatch(/^Which category\?/);
  });

  it('asks for a unit on a bare number rather than guessing', () => {
    expect(msg('company 45')).toBe('Is "45" minutes or hours? Write 45m or 45h.');
    expect(msg('2 builds')).toBe('Is "2" minutes or hours? Write 2m or 2h.');
    expect(msg('masters 1.5')).toBe('Is "1.5" minutes or hours? Write 1.5m or 1.5h.');
  });

  it('names the unknown or misplaced category', () => {
    expect(msg('reading 1h')).toBe('No category starts with "reading". Use Company, Masters, Training or Builds.');
    expect(msg('1h reading masters')).toBe('Put the category at the start, next to the duration: "masters 1h reading …".');
  });

  it('refuses an ambiguous prefix and lists the candidates', () => {
    const more: Category[] = [...cats, { id: 'travel', label: 'Travel', color: 4 }];
    expect(msg('tr 1h', WED, more)).toBe('"tr" could be Training or Travel. Type a few more letters.');
    expect(p('tra 1h', WED, more).ok).toBe(false);
    expect(p('trav 1h', WED, more)).toMatchObject({ ok: true, category: 'travel' });
  });

  it('refuses the future, zero and impossible lengths', () => {
    expect(msg('masters 1h tomorrow')).toBe('That day is in the future. Log it once it has happened.');
    expect(msg('2026-12-01 masters 1h')).toBe('That day is in the future. Log it once it has happened.');
    expect(msg('masters 0m')).toBe('The duration has to be more than zero.');
    expect(msg('company 25h')).toMatch(/more than 24 hours/);
    expect(p('company 24h').ok).toBe(true);
  });

  it('does not match archived categories and copes with none at all', () => {
    const c = cats.map((x) => (x.id === 'builds' ? { ...x, archived: true } : x));
    expect(msg('builds 1h', WED, c)).toBe('No category starts with "builds". Use Company, Masters or Training.');
    expect(msg('builds 1h', WED, [])).toBe('There are no categories yet. Add one in Settings.');
  });
});
