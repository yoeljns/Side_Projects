import { useEffect, useRef } from 'react';
import { COURT_L, COURT_LINES, COURT_W } from '../lib/court';
import { positionAt } from '../lib/stats';
import { SLOT_NAME, type Sample } from '../lib/tracker';

const TRAIL_SEC = 2.5;

/** Live top-down view of the four players, synced to the video's clock. */
export function Tactical({ video, tracks, me }: { video: HTMLVideoElement; tracks: Sample[][]; me: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
      if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
      const ctx = c.getContext('2d')!;
      const css = getComputedStyle(c);
      const ink = css.getPropertyValue('--text').trim(), line = css.getPropertyValue('--court-line').trim();
      const accent = css.getPropertyValue('--accent').trim(), surface = css.getPropertyValue('--surface').trim();
      const pad = 8, sx = (w - pad * 2) / COURT_W, sy = (h - pad * 2) / COURT_L;
      const X = (x: number) => pad + x * sx, Y = (y: number) => pad + (COURT_L - y) * sy;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of COURT_LINES) { ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); }
      ctx.stroke();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(0), Y(COURT_L / 2)); ctx.lineTo(X(COURT_W), Y(COURT_L / 2)); ctx.stroke();

      const t = video.currentTime;
      tracks.forEach((track, slot) => {
        const p = positionAt(track, t);
        if (!p) return;
        const color = slot === me ? accent : ink;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let pen = false;
        for (let dt = TRAIL_SEC; dt >= 0; dt -= 0.2) {
          const q = positionAt(track, t - dt);
          if (!q) { pen = false; continue; }
          if (pen) ctx.lineTo(X(q.x), Y(q.y)); else ctx.moveTo(X(q.x), Y(q.y));
          pen = true;
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), 9, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = surface;
        ctx.stroke();
        ctx.fillStyle = surface;
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(SLOT_NAME[slot], X(p.x), Y(p.y) + 0.5);
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video, tracks, me]);
  return <canvas ref={ref} className="tactical" role="img" aria-label="Top-down view of player positions at the current moment of the video" />;
}
