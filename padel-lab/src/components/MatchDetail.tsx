import { useState } from 'react';
import { fmtClock, fmtDate } from '../lib/format';
import type { Match } from '../lib/store';
import { StatsView } from './StatsView';

export function MatchDetail({ match, onBack, onDelete }: { match: Match; onBack: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const facts = [
    match.result ? (match.result === 'W' ? 'Won' : 'Lost') : null,
    match.score || null,
    match.level !== null ? `level ${match.level.toFixed(2)}` : null,
    match.partner ? `with ${match.partner}` : null,
    match.opponents ? `against ${match.opponents}` : null,
  ].filter(Boolean);
  return (
    <main className="page">
      <header className="pagehead">
        <button className="link" onClick={onBack}>← Match log</button>
      </header>
      <div className="detail-head">
        {match.meThumb && <img src={match.meThumb} alt="" />}
        <div>
          <h1>{fmtDate(match.date)}</h1>
          {facts.length > 0 && <p>{facts.join(' · ')}</p>}
          <p className="muted small">{match.videoName} · {fmtClock(match.analysedSec)} analysed</p>
          {match.notes && <p className="notes">{match.notes}</p>}
        </div>
      </div>
      <StatsView players={match.players} rallies={match.rallies} me={match.me} inPlayOnly={match.inPlayOnly} />
      <div className="actions">
        {confirm ? (
          <>
            <button className="danger" onClick={onDelete}>Delete this match</button>
            <button onClick={() => setConfirm(false)}>Keep it</button>
          </>
        ) : (
          <button onClick={() => setConfirm(true)}>Delete…</button>
        )}
      </div>
    </main>
  );
}
