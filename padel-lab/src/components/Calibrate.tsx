import { useCallback, useEffect, useRef, useState } from 'react';
import { COURT_L, COURT_LINES, COURT_W, PRESETS, presetById, type PresetId, type Pt } from '../lib/court';
import { fmtClock } from '../lib/format';
import { homography, isConvexQuad, project } from '../lib/homography';

const GRAB_PX = 28;

/** Draws the tapped points and, once there are four, the court they imply. */
function draw(canvas: HTMLCanvasElement, pts: Pt[], court: Pt[], video: HTMLVideoElement, active: number | null): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const px = pts.map((p) => ({ x: p.x * w, y: p.y * h }));

  if (px.length === 4 && isConvexQuad(px)) {
    const hm = homography(court, px);
    if (hm) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(57, 135, 229, 0.95)';
      ctx.beginPath();
      for (const [a, b] of COURT_LINES) {
        // Sample along each line so parts behind the camera are simply skipped.
        let pen = false;
        for (let i = 0; i <= 20; i++) {
          const q = project(hm, { x: a.x + ((b.x - a.x) * i) / 20, y: a.y + ((b.y - a.y) * i) / 20 });
          if (!q || Math.abs(q.x) > w * 4 || Math.abs(q.y) > h * 4) { pen = false; continue; }
          if (pen) ctx.lineTo(q.x, q.y);
          else ctx.moveTo(q.x, q.y);
          pen = true;
        }
      }
      ctx.stroke();
    }
  } else if (px.length > 1) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    px.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (px.length === 4) ctx.closePath();
    ctx.stroke();
  }

  px.forEach((p, i) => {
    if (i === active) return; // the loupe shows this one
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11,11,11,0.75)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), p.x, p.y - 22);
  });

  // Loupe: a magnified view around the point being placed, clear of the finger.
  if (active !== null && px[active] && video.videoWidth) {
    const p = px[active];
    const R = Math.min(70, w * 0.16), ZOOM = 4;
    const cx = Math.min(w - R - 4, Math.max(R + 4, p.x));
    const cy = p.y - R - 36 > 4 ? p.y - R - 36 : p.y + R + 36;
    const srcW = ((2 * R) / ZOOM) * (video.videoWidth / w), srcH = ((2 * R) / ZOOM) * (video.videoHeight / h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.drawImage(
      video,
      pts[active].x * video.videoWidth - srcW / 2, pts[active].y * video.videoHeight - srcH / 2, srcW, srcH,
      cx - R, cy - R, 2 * R, 2 * R,
    );
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx - 6, cy); ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy - 6); ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}

/** Little court diagram showing where the four reference points sit. */
function PresetDiagram({ presetId, next }: { presetId: PresetId; next: number }) {
  const preset = presetById(presetId);
  return (
    <svg className="preset-diagram" viewBox={`-1.5 -1.5 ${COURT_W + 3} ${COURT_L + 3}`} aria-hidden="true">
      {COURT_LINES.map(([a, b], i) => (
        <line key={i} x1={a.x} y1={COURT_L - a.y} x2={b.x} y2={COURT_L - b.y} />
      ))}
      {preset.points.map((p, i) => (
        <g key={i} className={i === next ? 'next' : undefined}>
          <circle cx={p.x} cy={COURT_L - p.y} r={1.25} />
          <text x={p.x} y={COURT_L - p.y + 0.55} textAnchor="middle">{i + 1}</text>
        </g>
      ))}
      <text className="cam" x={COURT_W / 2} y={COURT_L + 1.35} textAnchor="middle">camera</text>
    </svg>
  );
}

export function Calibrate({
  video,
  overlay,
  onDone,
  busy,
  error,
}: {
  video: HTMLVideoElement;
  overlay: HTMLCanvasElement;
  onDone: (image: Pt[], court: Pt[]) => void;
  busy: boolean;
  error: string | null;
}) {
  const [presetId, setPresetId] = useState<PresetId>('service');
  const [pts, setPts] = useState<Pt[]>([]);
  const [time, setTime] = useState(0);
  const drag = useRef<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const preset = presetById(presetId);
  const valid = pts.length === 4 && isConvexQuad(pts);

  const redraw = useCallback(() => draw(overlay, pts, preset.points, video, active), [overlay, pts, preset, video, active]);
  useEffect(() => {
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(overlay);
    return () => ro.disconnect();
  }, [redraw, overlay]);

  useEffect(() => {
    // Start a little way in: the first frames are often someone walking to the tripod.
    const t = Math.min(video.duration * 0.1, 20) || 0;
    video.currentTime = t;
    setTime(t);
  }, [video]);

  useEffect(() => {
    const at = (e: PointerEvent): Pt => {
      const r = overlay.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      };
    };
    const down = (e: PointerEvent) => {
      if (busy) return;
      const r = overlay.getBoundingClientRect();
      const p = at(e);
      let hit = -1, best = GRAB_PX;
      pts.forEach((q, i) => {
        const d = Math.hypot((q.x - p.x) * r.width, (q.y - p.y) * r.height);
        if (d < best) { best = d; hit = i; }
      });
      if (hit >= 0) drag.current = hit;
      else if (pts.length < 4) {
        drag.current = pts.length;
        setPts([...pts, p]);
      } else return;
      setActive(drag.current);
      overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      const i = drag.current;
      if (i === null) return;
      const p = at(e);
      setPts((cur) => cur.map((q, k) => (k === i ? p : q)));
    };
    const up = () => { drag.current = null; setActive(null); };
    overlay.addEventListener('pointerdown', down);
    overlay.addEventListener('pointermove', move);
    overlay.addEventListener('pointerup', up);
    overlay.addEventListener('pointercancel', up);
    return () => {
      overlay.removeEventListener('pointerdown', down);
      overlay.removeEventListener('pointermove', move);
      overlay.removeEventListener('pointerup', up);
      overlay.removeEventListener('pointercancel', up);
    };
  }, [overlay, pts, busy]);

  return (
    <div className="step">
      <label className="scrub">
        <span>Frame {fmtClock(time)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, video.duration - 0.1) || 0}
          step={0.1}
          value={time}
          disabled={busy}
          onChange={(e) => {
            const t = Number(e.target.value);
            setTime(t);
            video.currentTime = t;
          }}
        />
      </label>

      <div className="calib">
        <PresetDiagram presetId={presetId} next={pts.length} />
        <div>
          <h2>Mark the court</h2>
          <p className="muted">
            Press and hold on each of four floor points: a magnifier appears so you can slide onto the exact spot. Drag
            a point again to fine-tune. The blue lines should end up on the painted lines.
          </p>
          <label className="field">
            <span>Reference points</span>
            <select
              value={presetId}
              disabled={busy}
              onChange={(e) => {
                setPresetId(e.target.value as PresetId);
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <p className="muted small">{preset.hint}</p>
          <ol className="pointlist">
            {preset.labels.map((l, i) => (
              <li key={i} className={i < pts.length ? 'done' : i === pts.length ? 'next' : undefined}>{l}</li>
            ))}
          </ol>
          {pts.length === 4 && !valid && (
            <p className="error">Those points cross over. Tap them in order 1–4 as in the diagram, or reset.</p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button className="primary" disabled={!valid || busy} onClick={() => onDone(pts, preset.points)}>
              {busy ? 'Loading player detector…' : 'Start analysis'}
            </button>
            <button disabled={pts.length === 0 || busy} onClick={() => setPts([])}>Reset points</button>
          </div>
        </div>
      </div>
    </div>
  );
}
