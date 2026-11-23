// The finished review as one markdown file: the record tables, then the questions and answers.
import { type Comparison, type YearRecord, headlines } from './record';
import { coverage, fmtNum, sectionView, type Table, yearTitle } from './present';
import { type Question, SECTION_IDS, SECTION_LABEL } from './types';

const cell = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ').trim();

export function mdTable(t: Pick<Table, 'head' | 'numeric' | 'rows'>): string {
  const head = `| ${t.head.map(cell).join(' | ')} |`;
  const rule = `| ${t.head.map((_, i) => (t.numeric.includes(i) ? '---:' : '---')).join(' | ')} |`;
  return [head, rule, ...t.rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

const value = (v: number | null, digits: number, unit?: string): string => (v === null ? '' : `${fmtNum(v, digits)}${unit ? ` ${unit}` : ''}`);
const signed = (v: number | null, digits: number): string => (v === null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), digits)}`);

export interface ReviewExport {
  record: YearRecord;
  questions: Question[];
  answers: Record<string, string>;
  /** Against the year before, when that year has a record. */
  comparison: Comparison[] | null;
}

export function reviewMarkdown({ record: r, questions, answers, comparison }: ReviewExport): string {
  const out: string[] = [];
  out.push('---', 'type: year-review', `year_start: ${r.window.start}`, `year_end: ${r.window.last}`, `exported: ${r.today}`, '---', '');
  out.push(`# Year in data: ${yearTitle(r)}`, '', coverage(r), '');

  out.push('## Headline numbers', '');
  const heads = headlines(r).filter((h) => h.value !== null);
  if (!heads.length) out.push('No records are loaded for this year.', '');
  else if (comparison && comparison.some((c) => c.previous !== null)) {
    out.push(mdTable({
      head: ['', 'This year', 'Year before', 'Change'],
      numeric: [1, 2, 3],
      rows: comparison.filter((c) => c.current !== null || c.previous !== null).map((c) => [c.label, value(c.current, c.digits, c.unit), value(c.previous, c.digits, c.unit), signed(c.delta, c.digits)]),
    }), '');
  } else out.push(mdTable({ head: ['', 'This year'], numeric: [1], rows: heads.map((h) => [h.label, value(h.value, h.digits, h.unit)]) }), '');

  out.push('## The record', '');
  for (const id of SECTION_IDS) {
    const v = sectionView(id, r);
    out.push(`### ${v.title}`, '');
    if (v.missing) { out.push(`_${v.missing}_`, ''); continue; }
    for (const f of v.facts) out.push(`- ${f.label}: ${f.value}`);
    if (v.facts.length) out.push('');
    for (const t of v.tables) out.push(`**${t.title}**`, '', mdTable(t), '');
  }

  out.push('## The questions', '');
  if (!questions.length) out.push('No questions are set.', '');
  questions.forEach((q, i) => {
    out.push(`### ${i + 1}. ${q.text.replace(/\s*\r?\n\s*/g, ' ').trim()}`, '');
    if (q.sections.length) out.push(`_Record beside this question: ${q.sections.map((s) => SECTION_LABEL[s].toLowerCase()).join(', ')}._`, '');
    const a = (answers[q.id] ?? '').trim();
    out.push(a || '_Not answered yet._', '');
  });
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export const reviewFilename = (r: YearRecord): string => `year-in-data-${r.window.start}-to-${r.window.last}.md`;
