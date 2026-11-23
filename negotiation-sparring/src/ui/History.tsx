import { FAMILIES, trend, type SessionRecord } from '../engine/index.js';

const OUTCOME: Record<SessionRecord['outcome'], string> = { deal: 'Deal', 'player-walked': 'You walked', 'counterpart-walked': 'They walked' };

function ScoreChart({ records }: { records: SessionRecord[] }) {
  const W = 640;
  const H = 180;
  const m = { l: 34, r: 10, t: 10, b: 22 };
  const x = (k: number) => m.l + ((W - m.l - m.r) * (records.length === 1 ? 0.5 : k / (records.length - 1)));
  const y = (s: number) => H - m.b - ((H - m.t - m.b) * (s + 100)) / 250;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label="Score for each session, oldest first">
      {[-100, 0, 100, 150].map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={t === 100 ? 'var(--accent)' : 'var(--border)'} strokeDasharray={t === 100 ? '4 3' : undefined} />
          <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{t}</text>
        </g>
      ))}
      <text x={W - m.r} y={y(100) - 5} textAnchor="end" className="tick">Nash</text>
      <text x={m.l} y={H - 5} className="tick">first</text>
      <text x={W - m.r} y={H - 5} textAnchor="end" className="tick">latest</text>
      {records.length > 1 && (
        <polyline points={records.map((r, k) => `${x(k).toFixed(1)},${y(r.score).toFixed(1)}`).join(' ')} fill="none" stroke="var(--text)" strokeWidth="1.5" opacity="0.6" />
      )}
      {records.map((r, k) => (
        <circle key={r.id} cx={x(k)} cy={y(r.score)} r="4" fill={r.score >= 75 ? 'var(--good)' : r.score >= 25 ? 'var(--warn)' : 'var(--bad)'} stroke="var(--surface)" strokeWidth="1.5">
          <title>{`${r.date}: ${r.score} (${r.grade})`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function History({ sessions, onDelete, onClear }: { sessions: SessionRecord[]; onDelete: (id: string) => void; onClear: () => void }) {
  if (!sessions.length) {
    return (
      <section className="card">
        <h2>History</h2>
        <p className="empty">No finished sessions yet. Scores appear here after your first debrief.</p>
      </section>
    );
  }
  const t = trend(sessions);
  const fmt = (x: number | null) => (x === null ? 'n/a' : Math.round(x).toString());
  return (
    <>
      <section className="card">
        <h2>Score trend</h2>
        <div className="stats">
          <div className="stat">
            <b>{t.count}</b>
            <span>Sessions</span>
          </div>
          <div className="stat">
            <b>{fmt(t.recent)}</b>
            <span>Average, latest 5</span>
          </div>
          <div className="stat">
            <b>{fmt(t.previous)}</b>
            <span>Average, the 5 before</span>
          </div>
          <div className="stat">
            <b>{fmt(t.best)}</b>
            <span>Best</span>
          </div>
        </div>
        <ScoreChart records={sessions} />
        <p className="small muted">100 means you did as well as the Nash solution; walking away correctly also scores 100. Below 0 is a deal worse than your alternative.</p>
      </section>
      <section className="card">
        <div className="card-head">
          <h2>Sessions</h2>
          <button className="btn small danger" onClick={() => confirm('Delete every session in the history?') && onClear()}>
            Clear history
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Scenario</th>
                <th>Level</th>
                <th>Against</th>
                <th>Outcome</th>
                <th className="num">Rounds</th>
                <th className="num">Score</th>
                <th>Grade</th>
                <th>
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...sessions].reverse().map((r) => (
                <tr key={r.id}>
                  <td className="nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>{r.date}</td>
                  <td>
                    {FAMILIES[r.family].title}, as {FAMILIES[r.family].roles[r.role].toLowerCase()}
                  </td>
                  <td>{r.difficulty}</td>
                  <td>{r.counterpart === 'ai' ? 'AI' : r.counterpart === 'mixed' ? 'AI and script' : 'Script'}</td>
                  <td>
                    {OUTCOME[r.outcome]}
                    {!r.zopaExists && <span className="muted"> (no deal possible)</span>}
                  </td>
                  <td className="num">{r.rounds}</td>
                  <td className="num">{r.score}</td>
                  <td className="strong">{r.grade}</td>
                  <td>
                    <button className="btn small" onClick={() => onDelete(r.id)} aria-label={`Delete session of ${r.date}`}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
