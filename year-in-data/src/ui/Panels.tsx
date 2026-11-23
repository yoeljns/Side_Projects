// The record beside a question: plain facts, a small chart, the notable items.
// Evidence only. Nothing here comments on the numbers.
import type { ReactNode } from 'react';
import { type Fact, type SectionView, type Table, coverage, fmtNum, sectionView, yearTitle } from '../lib/present';
import { type Comparison, type YearRecord, headlines } from '../lib/record';
import { type Question, type SectionId, SECTION_IDS } from '../lib/types';
import { CallsPlot, MonthColumns, NightsByMonth, RankBars, SplitBar } from './Charts';

const isLink = (s: string) => /^https?:\/\/\S+$/.test(s);

export function Facts({ facts }: { facts: Fact[] }) {
  return (
    <dl className="facts">
      {facts.map((f) => (
        <div key={f.label} style={{ display: 'contents' }}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataTable({ table }: { table: Pick<Table, 'head' | 'numeric' | 'rows'> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{table.head.map((h, i) => <th key={i} className={table.numeric.includes(i) ? 'num' : undefined}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, k) => (
            <tr key={k}>
              {r.map((c, i) => (
                <td key={i} className={table.numeric.includes(i) ? 'num' : c.length > 24 ? 'clip' : c.length <= 16 ? 'nowrap' : undefined}>
                  {isLink(c) ? <a href={c} target="_blank" rel="noreferrer" className="wrap-any">{c.replace(/^https?:\/\//, '')}</a> : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Short tables are shown; long ones fold away behind their title. */
function FoldTable({ table }: { table: Table }) {
  if (table.rows.length <= 6) {
    return (
      <div className="stack-tight">
        <div className="tbl-title">{table.title}</div>
        <DataTable table={table} />
      </div>
    );
  }
  return (
    <details className="tbl">
      <summary>{table.title} ({table.rows.length} rows)</summary>
      <DataTable table={table} />
    </details>
  );
}

function charts(id: SectionId, r: YearRecord): ReactNode {
  if (id === 'trips' && r.trips && r.trips.nights > r.trips.buckets.unrecorded) return <NightsByMonth months={r.trips.months} />;
  if (id === 'matches' && r.matches && r.matches.count > 0) {
    return <SplitBar title="Home and away" parts={[{ label: 'Home', value: r.matches.home, color: 'var(--accent)' }, { label: 'Away', value: r.matches.away, color: 'var(--neutral)' }]} />;
  }
  if (id === 'games' && r.chess && r.chess.total > 0) {
    return (
      <>
        <SplitBar title="Chess results" parts={[{ label: 'Won', value: r.chess.win, color: 'var(--accent)' }, { label: 'Drawn', value: r.chess.draw, color: 'var(--neutral)' }, { label: 'Lost', value: r.chess.loss, color: 'var(--istanbul)' }]} />
        <MonthColumns title="Chess games by month" data={r.chess.byMonth.map((m) => ({ month: m.month, value: m.games }))} format={(v) => `${v} games`} />
      </>
    );
  }
  if (id === 'books' && r.books.count > 0) return <MonthColumns title="Books finished by month" data={r.books.byMonth.map((m) => ({ month: m.month, value: m.count }))} format={(v) => `${v} finished`} />;
  if (id === 'builds') {
    return r.repos.filter((x) => x.total > 0).map((repo) => (
      <MonthColumns key={repo.repo} title={`Commits by month in ${repo.repo}`} data={Object.entries(repo.byMonth).map(([month, value]) => ({ month, value }))} format={(v) => `${v} commits`} />
    ));
  }
  if (id === 'hours' && r.hours && r.hours.entries > 0) {
    return (
      <>
        <RankBars title="Hours by category" rows={r.hours.byCategory.map((c) => ({ label: c.label, value: c.minutes, text: `${fmtNum(c.minutes / 60, 0)} h` }))} />
        <MonthColumns title="Hours by month" unit=" h" data={r.hours.byMonth.map((m) => ({ month: m.month, value: Math.round(m.minutes / 6) / 10 }))} format={(v) => `${fmtNum(v, 1)} h`} />
      </>
    );
  }
  if (id === 'decisions' && r.decisions && r.decisions.resolved.length > 0) return <CallsPlot calls={r.decisions.resolved} />;
  return null;
}

export function SectionPanel({ id, record }: { id: SectionId; record: YearRecord }) {
  const v = sectionView(id, record);
  return (
    <section className="section-panel" aria-label={v.title}>
      <h3>{v.title}</h3>
      {v.missing ? <p className="notice">{v.missing}</p> : (
        <>
          <Facts facts={v.facts} />
          {charts(id, record)}
          {v.tables.map((t) => <FoldTable key={t.title} table={t} />)}
        </>
      )}
    </section>
  );
}

const shown = (v: number | null, digits: number, unit?: string) => (v === null ? '' : `${fmtNum(v, digits)}${unit ? ` ${unit}` : ''}`);
export const signed = (v: number, digits: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), digits)}`;

export function comparisonTable(rows: Comparison[]): Pick<Table, 'head' | 'numeric' | 'rows'> {
  return {
    head: ['', 'This year', 'Year before', 'Change'],
    numeric: [1, 2, 3],
    rows: rows.filter((c) => c.current !== null || c.previous !== null).map((c) => [c.label, shown(c.current, c.digits, c.unit), shown(c.previous, c.digits, c.unit), c.delta === null ? '' : signed(c.delta, c.digits)]),
  };
}

function PrintSection({ view }: { view: SectionView }) {
  return (
    <div>
      <h3>{view.title}</h3>
      {view.missing ? <p className="muted">{view.missing}</p> : (
        <>
          <Facts facts={view.facts} />
          {view.tables.map((t) => (
            <div key={t.title}>
              <div className="tbl-title">{t.title}</div>
              <DataTable table={t} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** The whole review laid out for paper. Hidden on screen; the print stylesheet shows only this. */
export function PrintView({ record, questions, answers, comparison }: { record: YearRecord; questions: Question[]; answers: Record<string, string>; comparison: Comparison[] | null }) {
  const beside = new Set(questions.flatMap((q) => q.sections));
  const rest = SECTION_IDS.filter((id) => !beside.has(id)).map((id) => sectionView(id, record)).filter((v) => !v.missing);
  const heads = headlines(record).filter((h) => h.value !== null);
  return (
    <div className="print-only">
      <h1>Year in data</h1>
      <p>{yearTitle(record)}. {coverage(record)}</p>
      {heads.length > 0 && (
        <>
          <h2>Headline numbers</h2>
          {comparison && comparison.some((c) => c.previous !== null)
            ? <DataTable table={comparisonTable(comparison)} />
            : <DataTable table={{ head: ['', 'This year'], numeric: [1], rows: heads.map((h) => [h.label, shown(h.value, h.digits, h.unit)]) }} />}
        </>
      )}
      {questions.map((q, i) => (
        <div className="q-block" key={q.id}>
          <h2>{i + 1}. {q.text}</h2>
          {q.sections.map((id) => <PrintSection key={id} view={sectionView(id, record)} />)}
          <h3>Answer</h3>
          <p className="answer-text">{(answers[q.id] ?? '').trim() || 'Not answered yet.'}</p>
        </div>
      ))}
      {rest.length > 0 && (
        <div className="q-block">
          <h2>The rest of the record</h2>
          {rest.map((v) => <PrintSection key={v.id} view={v} />)}
        </div>
      )}
    </div>
  );
}

