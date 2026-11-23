import { useRef, useState } from 'react';
import { fmtDate, fmtDateShort, fmtSec, pct } from '../lib/format';
import { exportMatches, importMatches, loadMatches, myStats, type Match } from '../lib/store';
import { TrendChart } from './Charts';
import { FilmingTips } from './NewAnalysis';
import { Tile } from './StatsView';

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function Home({
  matches,
  onNew,
  onOpen,
  onChange,
}: {
  matches: Match[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onChange: (list: Match[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportMatches()], { type: 'application/json' }));
    a.download = 'padel-lab-matches.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const n = importMatches(await f.text());
      onChange(loadMatches());
      setNote(`Imported ${n} ${n === 1 ? 'match' : 'matches'}.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  const decided = matches.filter((m) => m.result);
  const wins = decided.filter((m) => m.result === 'W').length;
  const recent = matches.slice(-5);
  const netRecent = avg(recent.map(myStats).filter((p) => p !== null && p.seenSec > 0).map((p) => p!.zonePct.net));
  const rallyRecent = avg(recent.filter((m) => m.rallies && m.rallies.count > 0).map((m) => m.rallies!.avgSec));
  const level = [...matches].reverse().find((m) => m.level !== null)?.level ?? null;
  const label = (m: Match) => fmtDateShort(m.date);

  return (
    <main className="page">
      <header className="hero">
        <div>
          <h1>Padel Lab</h1>
          <p className="muted">Where you stand, how long the rallies run, and how that moves with your level.</p>
        </div>
        <button className="primary" onClick={onNew}>Analyse a match</button>
      </header>

      {matches.length === 0 ? (
        <>
          <div className="card empty">
            <h2>No matches yet</h2>
            <p className="muted">
              Film a match from behind the court, then load the video here. You get a position heatmap for each player,
              time at the net, and rally lengths. Everything runs in your browser.
            </p>
          </div>
          <FilmingTips />
        </>
      ) : (
        <>
          <div className="tiles">
            <Tile label="Matches" value={String(matches.length)} note={decided.length ? `${wins} won of ${decided.length} scored` : undefined} />
            <Tile label="Level" value={level === null ? '–' : level.toFixed(2)} note="latest logged" />
            <Tile label="Time at the net" value={netRecent === null ? '–' : pct(netRecent)} note="last 5 matches" />
            <Tile label="Average rally" value={rallyRecent === null ? '–' : fmtSec(rallyRecent)} note="last 5 matches" />
          </div>

          <section>
            <h2>Over time</h2>
            <div className="trends">
              <TrendChart title="Level" format={(v) => v.toFixed(2)} points={matches.map((m) => ({ label: label(m), value: m.level }))} />
              <TrendChart
                title="Time at the net"
                format={(v) => `${Math.round(v)}%`}
                zeroBased
                points={matches.map((m) => {
                  const p = myStats(m);
                  return { label: label(m), value: p && p.seenSec > 0 ? p.zonePct.net * 100 : null };
                })}
              />
              <TrendChart
                title="Average rally length"
                format={(v) => `${v.toFixed(1)} s`}
                zeroBased
                points={matches.map((m) => ({ label: label(m), value: m.rallies && m.rallies.count > 0 ? m.rallies.avgSec : null }))}
              />
            </div>
          </section>

          <section>
            <h2>Match log</h2>
            <div className="card tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Result</th><th className="num">Level</th><th className="num">Net</th>
                    <th className="num">Rallies</th><th className="num">Avg rally</th><th>Against</th>
                  </tr>
                </thead>
                <tbody>
                  {[...matches].reverse().map((m) => {
                    const p = myStats(m);
                    return (
                      <tr key={m.id} tabIndex={0} onClick={() => onOpen(m.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(m.id)}>
                        <td>{fmtDate(m.date)}</td>
                        <td>{m.result ? `${m.result === 'W' ? 'Won' : 'Lost'}${m.score ? ` ${m.score}` : ''}` : m.score || '–'}</td>
                        <td className="num">{m.level === null ? '–' : m.level.toFixed(2)}</td>
                        <td className="num">{p && p.seenSec > 0 ? pct(p.zonePct.net) : '–'}</td>
                        <td className="num">{m.rallies ? m.rallies.count : '–'}</td>
                        <td className="num">{m.rallies && m.rallies.count ? fmtSec(m.rallies.avgSec) : '–'}</td>
                        <td>{m.opponents || '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <footer className="foot">
        <span className="muted small">The match log is stored in this browser only.</span>
        <button className="link" onClick={download} disabled={matches.length === 0}>Export</button>
        <button className="link" onClick={() => fileRef.current?.click()}>Import</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        {note && <span className="muted small" role="status">{note}</span>}
      </footer>
    </main>
  );
}
