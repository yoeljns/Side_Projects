import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AnalysisResult } from '../lib/analyzer';
import { fmtClock, fmtSec, isoDay } from '../lib/format';
import { autoThresholdDb, dbToSensitivity, findPeaks, groupRallies, selectHits, sensitivityToDb, summariseRallies } from '../lib/hits';
import { buildInsights } from '../lib/insights';
import { computeStats, computeTeam, refineTrack } from '../lib/stats';
import { loadMatches, myStats, newId, type Match, type SavedPlayer } from '../lib/store';
import { SLOTS, SLOT_NAME, slotTeam } from '../lib/tracker';
import { StatsView } from './StatsView';
import { Tactical } from './Tactical';

export function Results({
  result,
  file,
  video,
  sideHost,
  onSave,
  onDiscard,
}: {
  result: AnalysisResult;
  file: File;
  video: HTMLVideoElement;
  /** Element next to the video where the top-down view is mounted. */
  sideHost: HTMLElement | null;
  onSave: (m: Match) => void;
  onDiscard: () => void;
}) {
  const [manual, setManual] = useState<number | null>(null);
  const [me, setMe] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [form, setForm] = useState({
    date: isoDay(new Date(file.lastModified || Date.now())),
    level: '',
    result: '' as Match['result'],
    score: '',
    partner: '',
    opponents: '',
    notes: '',
  });

  useEffect(() => {
    const on = () => setPlayhead(video.currentTime);
    video.addEventListener('timeupdate', on);
    video.addEventListener('seeked', on);
    return () => {
      video.removeEventListener('timeupdate', on);
      video.removeEventListener('seeked', on);
    };
  }, [video]);
  const seek = (t: number) => {
    video.currentTime = t;
    void video.play().catch(() => {});
    video.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const peaks = useMemo(() => (result.envelope ? findPeaks(result.envelope) : null), [result.envelope]);
  const autoDb = useMemo(() => (peaks ? autoThresholdDb(peaks) : 0), [peaks]);
  const rallies = useMemo(
    () => (peaks ? groupRallies(selectHits(peaks, manual === null ? autoDb : sensitivityToDb(manual))) : null),
    [peaks, autoDb, manual],
  );
  const summary = useMemo(() => (rallies ? summariseRallies(rallies, result.analysedSec) : null), [rallies, result.analysedSec]);

  // "In play only" needs enough rallies to be meaningful.
  const canFilter = !!rallies && rallies.length >= 3;
  const [wantInPlay, setWantInPlay] = useState(true);
  const inPlayOnly = canFilter && wantInPlay;

  const tracks = useMemo(() => result.samples.map(refineTrack), [result.samples]);
  const players: SavedPlayer[] = useMemo(
    () =>
      SLOTS.map((slot) => {
        const s = computeStats(tracks[slot], inPlayOnly ? rallies : null, slot < 2);
        return {
          slot,
          seenSec: Math.round(s.seenSec),
          zonePct: s.zonePct,
          distanceM: Math.round(s.distanceM),
          heat: s.heat,
          topSpeed: s.topSpeed,
          avgSpeed: s.avgSpeed,
          leftPct: s.leftPct,
          netApproaches: s.netApproaches,
          avgNetDist: s.avgNetDist,
        };
      }),
    [tracks, rallies, inPlayOnly],
  );
  const teams = useMemo(
    () => ({
      near: computeTeam(tracks[0], tracks[1], inPlayOnly ? rallies : null),
      far: computeTeam(tracks[2], tracks[3], inPlayOnly ? rallies : null),
    }),
    [tracks, rallies, inPlayOnly],
  );
  const pastNetPct = useMemo(() => {
    const past = loadMatches().map(myStats).filter((p) => p && p.seenSec > 0).map((p) => p!.zonePct.net);
    return past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
  }, []);
  const insights = useMemo(
    () => buildInsights({ players, me, teams, rallies: summary, pastNetPct }),
    [players, me, teams, summary, pastNetPct],
  );
  const longest = useMemo(
    () => (summary ? summary.list.slice().sort((a, b) => b[1] - a[1]).slice(0, 6) : []),
    [summary],
  );

  const anyTracked = result.samples.some((s) => s.length > 0);

  /** Everything computed, including the tracks themselves, as a JSON file. */
  const exportAnalysis = () => {
    const r1 = (v: number) => Math.round(v * 10) / 10, r2 = (v: number) => Math.round(v * 100) / 100;
    const data = {
      app: 'padel-lab',
      video: file.name,
      analysedSec: r1(result.analysedSec),
      framesSampled: result.frames,
      me,
      // [seconds, x metres across, y metres along] per player; y = 0 is the camera end
      tracks: tracks.map((t) => t.map((p) => [r1(p.t), r2(p.x), r2(p.y)])),
      rallies: rallies?.map((r) => ({ start: r1(r.start), end: r1(r.end), hits: r.hits })) ?? null,
      players,
      teams,
      rallySummary: summary,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `${file.name.replace(/\.[^.]+$/, '')}-padel-lab.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
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
      teams,
      rallies: summary,
    });
  };

  return (
    <div className="step results">
      {sideHost && createPortal(<Tactical video={video} tracks={tracks} me={me} />, sideHost)}
      <div>
        <h1>Results</h1>
        <p className="muted">
          {fmtClock(result.analysedSec)} of video analysed, {result.frames.toLocaleString()} frames sampled. Play the video
          above to watch it back with live positions.
        </p>
      </div>
      {!anyTracked && (
        <p className="error">
          No players were found on the court. Check the calibration lines sat on the court lines, and that the players
          are clearly visible.
        </p>
      )}

      {longest.length > 0 && (
        <section>
          <h2>Watch the longest rallies</h2>
          <div className="chips">
            {longest.map(([start, dur, hits]) => (
              <button key={start} onClick={() => seek(Math.max(0, start - 1.5))}>
                <strong>{fmtSec(dur)}</strong> at {fmtClock(start)} · {hits} hits
              </button>
            ))}
          </div>
        </section>
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
      </section>

      {peaks && (
        <section className="card controls">
          <label className="check">
            <input type="checkbox" checked={manual === null} onChange={(e) => setManual(e.target.checked ? null : dbToSensitivity(autoDb))} />
            <span>Set hit sensitivity automatically from this recording</span>
          </label>
          <label className="field">
            <span>Hit sensitivity</span>
            <input
              type="range"
              min={0}
              max={100}
              disabled={manual === null}
              value={manual ?? dbToSensitivity(autoDb)}
              onChange={(e) => setManual(Number(e.target.value))}
            />
          </label>
          <p className="muted small">
            Raise it if rallies are being missed, lower it if chatter or the next court is being counted.
          </p>
          <label className="check">
            <input type="checkbox" checked={inPlayOnly} disabled={!canFilter} onChange={(e) => setWantInPlay(e.target.checked)} />
            <span>Count positions during rallies only{canFilter ? '' : ' (needs at least 3 rallies)'}</span>
          </label>
        </section>
      )}

      <StatsView
        players={players}
        teams={teams}
        rallies={summary}
        insights={insights}
        me={me}
        inPlayOnly={inPlayOnly}
        totalSec={result.analysedSec}
        playhead={playhead}
        onSeek={seek}
      />

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
          <button onClick={exportAnalysis} disabled={!anyTracked}>Export tracks (JSON)</button>
        </div>
      </section>
    </div>
  );
}
