import { coverage, fmtNum } from '../lib/present';
import { type Comparison, type YearRecord, hasAnyRecord, headlines } from '../lib/record';
import { SOURCE_APP } from '../lib/sources';
import { YearStrip, dayMarks } from './Charts';
import { DataTable, comparisonTable, signed } from './Panels';

function missingSources(r: YearRecord): string[] {
  const out: string[] = [];
  if (!r.trips) out.push(`${SOURCE_APP.twoCity.title} (trips and matches)`);
  if (!r.chess) out.push('chess games for this year');
  if (!r.hours) out.push(`${SOURCE_APP.hours.title} (hours)`);
  if (!r.decisions) out.push(`${SOURCE_APP.decisions.title} (decisions)`);
  if (r.books.count === 0) out.push('books finished this year');
  if (r.builds.count === 0) out.push('builds shipped this year');
  return out;
}

export function Overview({ record, comparison, onRecords, onReview, exportBar }: { record: YearRecord; comparison: Comparison[] | null; onRecords: () => void; onReview: () => void; exportBar: React.ReactNode }) {
  const heads = headlines(record).filter((h) => h.value !== null);
  const deltas = new Map((comparison ?? []).map((c) => [c.id, c]));
  const missing = missingSources(record);
  const any = hasAnyRecord(record);
  const marks = dayMarks(record);

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>The year in numbers</h2>
          <span className="muted small">{coverage(record)}</span>
        </div>
        {any ? (
          <div className="stats">
            {heads.map((h) => {
              const d = deltas.get(h.id);
              return (
                <div className="stat" key={h.id}>
                  <b>{fmtNum(h.value!, h.digits)}{h.unit ? <span className="muted small"> {h.unit}</span> : null}</b>
                  <span>{h.label}</span>
                  {d && d.delta !== null && <small>{d.delta === 0 ? 'Same as the year before' : `${signed(d.delta, d.digits)} on the year before`}</small>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="stack-tight">
            <p className="empty">Nothing is on record for this year yet. Load the other apps' documents, fetch your games, or add books and builds.</p>
            <div className="btn-row"><button className="btn primary" onClick={onRecords}>Add records</button></div>
          </div>
        )}
        {any && missing.length > 0 && (
          <p className="notice small">
            Not on record for this year: {missing.join(', ')}. <button className="btn small" onClick={onRecords}>Add records</button>
          </p>
        )}
      </section>

      {(record.trips || marks.size > 0) && !record.notStarted && (
        <section className="card">
          <div className="card-head">
            <h2>Day by day</h2>
            <span className="muted small">{record.trips ? 'One cell per night, coloured by city' : 'No Two City document, so days have no city'}</span>
          </div>
          <YearStrip record={record} marks={marks} />
        </section>
      )}

      {comparison && comparison.some((c) => c.previous !== null) && (
        <section className="card">
          <div className="card-head">
            <h2>Against the year before</h2>
            {record.inProgress && <span className="muted small">This year is still running; the year before is complete</span>}
          </div>
          <DataTable table={comparisonTable(comparison)} />
          <p className="muted small">A blank means that year has nothing on record for that line, so no change is worked out.</p>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>The review</h2></div>
        <p className="muted">Go through your questions one at a time with the record beside each, then take the finished review away.</p>
        <div className="btn-row">
          <button className="btn primary" onClick={onReview}>Start the questions</button>
          {exportBar}
        </div>
      </section>
    </div>
  );
}
