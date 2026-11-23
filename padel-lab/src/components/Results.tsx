import { useMemo, useState } from 'react';
import type { AnalysisResult } from '../lib/analyzer';
import { fmtClock, isoDay } from '../lib/format';
import {
  DEFAULT_HIT_OPTIONS,
  DEFAULT_SENSITIVITY,
  detectHits,
  groupRallies,
  sensitivityToDb,
  summariseRallies,
} from '../lib/hits';
import { computeStats } from '../lib/stats';
import { newId, type Match, type SavedPlayer } from '../lib/store';
import { SLOTS, SLOT_NAME, slotTeam } from '../lib/tracker';
import { StatsView } from './StatsView';

export function Results({
  result,
  file,
  onSave,
  onDiscard,
}: {
  result: AnalysisResult;
  file: File;
  onSave: (m: Match) => void;
  onDiscard: () => void;
}) {
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY);
  const [me, setMe] = useState<number | null>(null);
  const [form, setForm] = useState({
    date: isoDay(new Date(file.lastModified || Date.now())),
    level: '',
    result: '' as Match['result'],
    score: '',
    partner: '',
    opponents: '',
    notes: '',
  });

  const rallies = useMemo(() => {
    if (!result.envelope) return null;
    const hits = detectHits(result.envelope, { ...DEFAULT_HIT_OPTIONS, thresholdDb: sensitivityToDb(sensitivity) });
    return groupRallies(hits);
  }, [result.envelope, sensitivity]);
  const summary = useMemo(() => (rallies ? summariseRallies(rallies) : null), [rallies]);

  // "In play only" needs enough rallies to be meaningful.
  const canFilter = !!rallies && rallies.length >= 3;
  const [wantInPlay, setWantInPlay] = useState(true);
  const inPlayOnly = canFilter && wantInPlay;

  const players: SavedPlayer[] = useMemo(
    () =>
      SLOTS.map((slot) => {
        const s = computeStats(result.samples[slot], inPlayOnly ? rallies : null);
        return { slot, seenSec: s.seenSec, zonePct: s.zonePct, distanceM: Math.round(s.distanceM), heat: s.heat };
      }),
    [result.samples, rallies, inPlayOnly],
  );
  const anyTracked = result.samples.some((s) => s.length > 0);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    const level = form.level.trim() === '' ? null : Number(form.level.replace(',', '.'));
    onSave({
      id: newId(),
      date: form.date || isoDay(new Date()),
      savedAt: new Date().toISOString(),
      level: level !== null && isFinite(level) ? level : null,
      result: form.result,
      score: form.score.trim(),
      partner: form.partner.trim(),
      opponents: form.opponents.trim(),
      notes: form.notes.trim(),
      videoName: file.name,
      analysedSec: Math.round(result.analysedSec),
      inPlayOnly,
      me,
      meThumb: me === null ? null : result.thumbs[me],
      players,
      rallies: summary,
    });
  };

  return (
    <div className="step results">
      <h1>Results</h1>
      <p className="muted">
        {fmtClock(result.analysedSec)} of video analysed, {result.frames.toLocaleString()} frames sampled.
      </p>
      {!anyTracked && (
        <p className="error">
          No players were found on the court. Check the calibration lines sat on the court lines, and that the players
          are clearly visible.
        </p>
      )}

      <section>
        <h2>Which one is you?</h2>
        <div className="who">
          {SLOTS.map((slot) => (
            <button
              key={slot}
              className={`who-card${me === slot ? ' selected' : ''}`}
              aria-pressed={me === slot}
              disabled={result.samples[slot].length === 0}
              onClick={() => setMe(me === slot ? null : slot)}
            >
              {result.thumbs[slot] ? <img src={result.thumbs[slot]!} alt="" /> : <span className="who-empty">not seen</span>}
              <strong>{SLOT_NAME[slot]}</strong>
              <span>{slotTeam(slot) === 'near' ? 'near side' : 'far side'}</span>
            </button>
          ))}
        </div>
        <p className="muted small">
          Players are followed per side of the net. Two partners can occasionally be swapped after crossing closely.
        </p>
      </section>

      {result.envelope && (
        <section className="card controls">
          <label className="field">
            <span>Hit sensitivity</span>
            <input type="range" min={0} max={100} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} />
          </label>
          <p className="muted small">
            Raise it if rallies are being missed (quiet recording), lower it if chatter or the next court is being counted.
          </p>
          <label className="check">
            <input type="checkbox" checked={inPlayOnly} disabled={!canFilter} onChange={(e) => setWantInPlay(e.target.checked)} />
            <span>Count positions during rallies only{canFilter ? '' : ' (needs at least 3 rallies)'}</span>
          </label>
        </section>
      )}

      <StatsView players={players} rallies={summary} me={me} inPlayOnly={inPlayOnly} />

      <section className="card">
        <h2>Save to match log</h2>
        <div className="form">
          <label className="field"><span>Date</span>
            <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label className="field"><span>Your level</span>
            <input inputMode="decimal" placeholder="e.g. 3.25" value={form.level} onChange={(e) => set('level', e.target.value)} /></label>
          <label className="field"><span>Result</span>
            <select value={form.result} onChange={(e) => set('result', e.target.value as Match['result'])}>
              <option value="">–</option><option value="W">Won</option><option value="L">Lost</option>
            </select></label>
          <label className="field"><span>Score</span>
            <input placeholder="6-4 3-6 7-5" value={form.score} onChange={(e) => set('score', e.target.value)} /></label>
          <label className="field"><span>Partner</span>
            <input value={form.partner} onChange={(e) => set('partner', e.target.value)} /></label>
          <label className="field"><span>Opponents</span>
            <input value={form.opponents} onChange={(e) => set('opponents', e.target.value)} /></label>
          <label className="field wide"><span>Notes</span>
            <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        </div>
        {me === null && anyTracked && <p className="muted small">Tip: pick which player is you above, so your trends can be tracked.</p>}
        <div className="actions">
          <button className="primary" onClick={save}>Save match</button>
          <button onClick={onDiscard}>Discard</button>
        </div>
      </section>
    </div>
  );
}
