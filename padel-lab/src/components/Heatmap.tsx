import { useEffect, useMemo, useRef, useState } from 'react';
import { CELL, COURT_L, COURT_LINES, COURT_W, GRID_L, GRID_W } from '../lib/court';
import { fmtSec } from '../lib/format';
import { useDark } from '../lib/useDark';

// Sequential blue ramp, light → dark. In dark mode it runs the other way so the
// low end still recedes into the surface.
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function rampColor(v: number, dark: boolean): number[] {
  const stops = dark ? RAMP.slice().reverse() : RAMP;
  const f = Math.min(1, Math.max(0, v)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return a.map((c, k) => c + (b[k] - c) * (f - i));
}

/** 3×3 box blur so single noisy cells don't dominate. */
function smooth(heat: number[]): number[] {
  const out = new Array(heat.length).fill(0);
  for (let y = 0; y < GRID_L; y++) {
    for (let x = 0; x < GRID_W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= GRID_W || yy >= GRID_L) continue;
          const w = dx === 0 && dy === 0 ? 4 : 1;
          s += heat[yy * GRID_W + xx] * w;
          n += w;
        }
      }
      out[y * GRID_W + x] = s / n;
    }
  }
  return out;
}

/** Top-down court with a time-spent heatmap. Far end at the top, camera at the bottom. */
export function Heatmap({ heat, label }: { heat: number[]; label: string }) {
  const dark = useDark();
  const ref = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const smoothed = useMemo(() => smooth(heat), [heat]);
  const max = useMemo(() => Math.max(0, ...smoothed), [smoothed]);

  useEffect(() => {
    const small = document.createElement('canvas');
    small.width = GRID_W;
    small.height = GRID_L;
    const sctx = small.getContext('2d')!;
    const img = sctx.createImageData(GRID_W, GRID_L);
    for (let y = 0; y < GRID_L; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const v = max > 0 ? smoothed[y * GRID_W + x] / max : 0;
        const o = ((GRID_L - 1 - y) * GRID_W + x) * 4; // flip: far end on top
        const [r, g, b] = rampColor(v, dark);
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = v < 0.02 ? 0 : Math.round(255 * Math.min(1, 0.35 + v * 2));
      }
    }
    sctx.putImageData(img, 0, 0);
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, c.width, c.height);
  }, [smoothed, max, dark]);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return setTip(null);
    const cx = Math.min(GRID_W - 1, Math.floor(fx * GRID_W));
    const cy = Math.min(GRID_L - 1, Math.floor((1 - fy) * GRID_L));
    const sec = heat[cy * GRID_W + cx];
    const fromNet = Math.abs((cy + 0.5) * CELL - COURT_L / 2);
    setTip({
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      text: `${fmtSec(sec)} here · ${fromNet.toFixed(1)} m from the net`,
    });
  };

  return (
    <div className="heatmap" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setTip(null)}>
      <canvas ref={ref} width={GRID_W * 12} height={GRID_L * 12} />
      <svg viewBox={`-0.15 -0.15 ${COURT_W + 0.3} ${COURT_L + 0.3}`} preserveAspectRatio="none" aria-hidden="true">
        {COURT_LINES.map(([a, b], i) => (
          <line
            key={i}
            x1={a.x}
            y1={COURT_L - a.y}
            x2={b.x}
            y2={COURT_L - b.y}
            className={a.y === COURT_L / 2 && b.y === COURT_L / 2 ? 'net' : undefined}
          />
        ))}
      </svg>
      {tip && (
        <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

export function HeatLegend() {
  const dark = useDark();
  const stops = (dark ? RAMP.slice().reverse() : RAMP).join(', ');
  return (
    <div className="heat-legend">
      <span>Less time</span>
      <i style={{ background: `linear-gradient(to right, ${stops})` }} />
      <span>More time</span>
    </div>
  );
}
