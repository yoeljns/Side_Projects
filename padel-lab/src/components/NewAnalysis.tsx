import { useEffect, useRef, useState } from 'react';
import { Analyzer, type AnalysisResult, type Progress } from '../lib/analyzer';
import type { Pt } from '../lib/court';
import { fmtClock } from '../lib/format';
import type { Match } from '../lib/store';
import { SLOT_NAME } from '../lib/tracker';
import { Calibrate } from './Calibrate';
import { Results } from './Results';

type Step = 'pick' | 'calibrate' | 'analyse' | 'results';

function drawBoxes(canvas: HTMLCanvasElement, video: HTMLVideoElement, p: Progress | null): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!p) return;
  const sx = w / video.videoWidth, sy = h / video.videoHeight;
  ctx.lineWidth = 2;
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  for (const { slot, det } of p.assignments) {
    const b = det.box;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(b.x * sx, b.y * sy, b.w * sx, b.h * sy);
    const label = SLOT_NAME[slot];
    ctx.fillStyle = 'rgba(11,11,11,0.8)';
    ctx.fillRect(b.x * sx - 1, b.y * sy - 17, 16, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, b.x * sx + 3, b.y * sy - 2);
  }
}

export function NewAnalysis({ onSave, onCancel }: { onSave: (m: Match) => void; onCancel: () => void }) {
  const [step, setStep] = useState<Step>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [sideHost, setSideHost] = useState<HTMLDivElement | null>(null);
  const analyzer = useRef<Analyzer | null>(null);
  const lastUi = useRef(0);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => analyzer.current?.stop(), []);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setReady(false);
    setFile(f);
    setUrl(URL.createObjectURL(f));
  };

  const start = async (image: Pt[], court: Pt[]) => {
    const video = videoRef.current!, overlay = overlayRef.current!;
    setBusy(true);
    setError(null);
    // Touch play() inside the tap so browsers allow the playback that follows.
    video.muted = true;
    await video.play().then(() => video.pause()).catch(() => {});
    const a = new Analyzer(video, { image, court }, (p) => {
      drawBoxes(overlay, video, p);
      const now = performance.now();
      if (now - lastUi.current > 250) { lastUi.current = now; setProgress(p); }
    });
    analyzer.current = a;
    try {
      await a.start();
      drawBoxes(overlay, video, null);
      setStep('analyse');
      const r = await a.result;
      analyzer.current = null;
      drawBoxes(overlay, video, null);
      setResult(r);
      setStep('results');
    } catch (e) {
      analyzer.current = null;
      setError(e instanceof Error ? e.message : 'Analysis could not start.');
    } finally {
      setBusy(false);
    }
  };

  const showVideo = step !== 'pick';
  return (
    <main className="page">
      <header className="pagehead">
        <button className="link" onClick={onCancel}>← Match log</button>
        <ol className="steps" aria-label="Progress">
          {(['Video', 'Court', 'Analyse', 'Results'] as const).map((s, i) => (
            <li key={s} className={i === ['pick', 'calibrate', 'analyse', 'results'].indexOf(step) ? 'current' : undefined}>{s}</li>
          ))}
        </ol>
      </header>

      {step === 'pick' && (
        <div className="step">
          <h1>Analyse a match</h1>
          <p className="muted">The video is processed on this device. Nothing is uploaded.</p>
          <label className="drop">
            <input type="file" accept="video/*" onChange={(e) => pick(e.target.files?.[0])} />
            <strong>{file ? file.name : 'Choose a match video'}</strong>
            <span>{file && !error ? 'Reading video…' : 'Landscape, whole court in frame'}</span>
          </label>
          {error && <p className="error">{error}</p>}
          <FilmingTips />
        </div>
      )}

      {url && (
        <div className={`review${step === 'results' ? ' with-side' : ''}`} hidden={!showVideo}>
          <div className="stage">
            <video
              ref={videoRef}
              src={url}
              playsInline
              preload="auto"
              controls={step === 'results'}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (!v.videoWidth) return setError('This file has no video track.');
                setReady(true);
                setStep('calibrate');
              }}
              onError={() => {
                if (step === 'pick') setError("This browser can't play that video format. Try exporting it as MP4 (H.264).");
              }}
            />
            <canvas ref={overlayRef} className={step === 'calibrate' ? 'interactive' : undefined} hidden={step === 'results'} />
          </div>
          {step === 'results' && <div className="review-side" ref={setSideHost} />}
        </div>
      )}

      {step === 'calibrate' && ready && videoRef.current && overlayRef.current && (
        <Calibrate video={videoRef.current} overlay={overlayRef.current} onDone={start} busy={busy} error={error} />
      )}

      {step === 'analyse' && (
        <div className="step">
          <h2>Analysing…</h2>
          <progress value={progress ? progress.t : 0} max={progress?.duration || 1} />
          <p className="muted">
            {progress
              ? `${fmtClock(progress.t)} of ${fmtClock(progress.duration)} · playing at ${progress.rate}× · ${progress.assignments.length} of 4 players in view · detector: ${progress.engine}`
              : 'Starting…'}
          </p>
          {progress && !progress.audio && (
            <p className="muted small">Audio could not be captured in this browser, so rallies will not be counted.</p>
          )}
          <p className="muted small">Keep this tab open and in front; analysis pauses when it is hidden.</p>
          <div className="actions">
            <button onClick={() => analyzer.current?.stop()}>Stop and use what's analysed so far</button>
          </div>
        </div>
      )}

      {step === 'results' && result && file && videoRef.current && (
        <Results result={result} file={file} video={videoRef.current} sideHost={sideHost} onSave={onSave} onDiscard={onCancel} />
      )}
    </main>
  );
}

export function FilmingTips() {
  return (
    <div className="card tips">
      <h3>Filming for good data</h3>
      <ul>
        <li>Tripod behind the back glass, centred, as high as it will go.</li>
        <li>Landscape, with both service lines and the far back wall in frame.</li>
        <li>Don't move the phone once play starts; one calibration covers the whole video.</li>
        <li>Record with sound. Hits are picked out of the audio to find rallies.</li>
      </ul>
    </div>
  );
}
