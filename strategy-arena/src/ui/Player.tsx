import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TournamentResult } from '../engine';
import { H, W, buildTimeline, drawFrame } from './animation';

const SPEEDS = [0.5, 1, 2, 4];
const canRecord = typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;

/**
 * Instagram and TikTok take MP4 (H.264) but not WebM, so prefer MP4 wherever the browser can record it.
 * Only H.264 types are asked for: a bare "video/mp4" may be filled with a codec those apps reject.
 */
const FORMATS = [
  { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];
const format = canRecord ? FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) : undefined;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Player({ result }: { result: TournamentResult }) {
  const tl = useMemo(() => buildTimeline(result), [result]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [recording, setRecording] = useState(false);

  const paint = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawFrame(ctx, tl, tRef.current);
  }, [tl]);

  const seek = useCallback(
    (to: number) => {
      tRef.current = Math.max(0, Math.min(tl.total, to));
      setT(tRef.current);
      paint();
    },
    [tl, paint],
  );

  const stopRecording = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  // A new run starts from the title card, paused.
  useEffect(() => {
    stopRecording();
    setPlaying(false);
    seek(0);
  }, [tl, seek, stopRecording]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      tRef.current = Math.min(tl.total, tRef.current + dt * speed);
      setT(tRef.current);
      paint();
      if (tRef.current >= tl.total) {
        setPlaying(false);
        window.setTimeout(stopRecording, 250); // let the last frame reach the encoder
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, tl, paint, stopRecording]);

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      stopRecording();
    } else {
      if (tRef.current >= tl.total) seek(0);
      setPlaying(true);
    }
  };

  const record = () => {
    const canvas = canvasRef.current;
    if (!canvas || !format) return;
    if (recRef.current) {
      setPlaying(false);
      stopRecording();
      return;
    }
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: format.mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      setRecording(false);
      rec.stream.getTracks().forEach((tr) => tr.stop());
      if (!chunks.length) return;
      const url = URL.createObjectURL(new Blob(chunks, { type: format.mime.split(';')[0] }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `strategy-arena-${result.config.arena}-${result.config.seed.replace(/[^\w-]+/g, '_')}.${format.ext}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };
    recRef.current = rec;
    setRecording(true);
    setSpeed(1);
    seek(0);
    rec.start();
    setPlaying(true);
  };

  return (
    <section className="card player" aria-label="Video playback">
      <div className="card-head">
        <h2>Short</h2>
        <span className="muted small">1080 × 1920 · {clock(tl.total)}</span>
      </div>
      <canvas ref={canvasRef} width={W} height={H} className="stage" onClick={toggle} />
      <input
        className="scrub"
        type="range"
        min={0}
        max={tl.total}
        step={0.01}
        value={t}
        aria-label="Playback position"
        disabled={recording}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <div className="player-controls">
        <button className="btn primary" onClick={toggle} data-testid="play">
          {playing ? 'Pause' : t >= tl.total ? 'Replay' : 'Play'}
        </button>
        <button className="btn" onClick={() => seek(0)} disabled={recording}>
          Restart
        </button>
        <label className="speed">
          <span className="sr-only">Speed</span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={recording}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <button
          className={`btn record${recording ? ' on' : ''}`}
          onClick={record}
          disabled={!format}
          title={format ? `Plays the run from the start at 1× and saves it as ${format.ext.toUpperCase()}` : 'This browser cannot record a canvas'}
          data-testid="record"
        >
          <span className="dot" />
          {recording ? 'Stop & save' : 'Record'}
        </button>
      </div>
      <p className="muted small" data-testid="format-note">
        {recording
          ? `Recording… ${clock(t)} / ${clock(tl.total)}. Keep this tab in view.`
          : !format
            ? 'This browser cannot record the canvas. Try a current Chrome, Edge, Safari or Firefox.'
            : format.ext === 'mp4'
              ? 'Record plays the run once in real time and downloads an MP4 (H.264), ready for Instagram and TikTok.'
              : 'Record plays the run once in real time and downloads a WebM: this browser cannot record MP4. Instagram and TikTok need MP4, so record in a current Chrome, Edge or Safari, or convert the file first.'}
      </p>
    </section>
  );
}
