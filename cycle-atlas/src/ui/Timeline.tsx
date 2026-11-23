// The timeline: one SVG, hand-drawn. Lanes of phase bands and event marks, the
// owner's annotations above them, links as curves between lanes. Wheel and
// pinch zoom around the pointer, drag pans, a click on empty lane space starts
// an annotation. The view (a range of years) lives in the parent.
import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type PointerEvent as RPointerEvent, type RefObject, type SetStateAction } from 'react';
import { readout, readoutClause } from '../lib/analysis';
import { isBuiltin, linkLag, phaseEnd } from '../lib/model';
import { fitText, packRows, pan, span, textWidth, ticks, xToYear, yScale, yearToX, zoomAround, type Limits, type View } from '../lib/scale';
import type { Annotation, ItemRef, Series, Track, TrackPref } from '../lib/types';
import { colorVar, EventShape, ItemCard, KindDefs, kindFill, StatusGlyph } from './marks';

export type Selection =
  | { type: 'item'; trackId: string; itemId: string; edge: 'start' | 'end' }
  | { type: 'ann'; id: string }
  | null;

interface Props {
  tracks: Track[];
  prefs: Record<string, TrackPref>;
  series: Series[];
  annotations: Annotation[];
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  limits: Limits;
  today: number;
  selected: Selection;
  onSelect: (s: Selection) => void;
  onStartAnnotation: (year: number, trackId?: string) => void;
  onRedate: (trackId: string, phaseId: string, edge: 'start' | 'end', year: number) => void;
  svgRef: RefObject<SVGSVGElement | null>;
}

const AXIS_H = 26;
const ANN_ROW = 22;
const LANE_LABEL = 18;
const EVENT_ROW = 20;
const LANE_GAP = 12;
const SERIES_H = 60;
const PAD = 8;

interface Lane {
  track: Track;
  top: number;
  bandTop: number;
  rowH: number;
  rows: Map<string, number>;
  bandH: number;
  eventY: number;
  bottom: number;
}

const fmt = (v: number): string => (Math.abs(v) >= 1000 ? v.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : v.toLocaleString('en-GB', { maximumFractionDigits: 2 }));

export function Timeline({ tracks, prefs, series, annotations, view, setView, limits, today, selected, onSelect, onStartAnnotation, onRedate, svgRef }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [cross, setCross] = useState<number | null>(null);
  const [tip, setTip] = useState<{ trackId: string; itemId: string; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const nowYear = Math.floor(today);
  const viewRef = useRef(view);
  viewRef.current = view;
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel must be a non-passive listener to stop the page scrolling while zooming.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const w = widthRef.current;
      const x = e.clientX - el.getBoundingClientRect().left;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        setView((v) => pan(v, (d / w) * span(v), limits));
      } else {
        const factor = Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * 0.0022);
        setView((v) => zoomAround(v, xToYear(v, w, x), factor, limits));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [limits, setView, svgRef]);

  const X = (year: number) => yearToX(view, width, year);

  // ----- vertical layout -----
  const annBoxes = useMemo(() => {
    const boxes: { id: string; x1: number; x2: number }[] = [];
    for (const a of annotations) {
      if (a.kind === 'pin') {
        const x = yearToX(view, width, a.year);
        const tw = textWidth(a.title, 11.5);
        // Near the right edge the label goes to the left of the marker.
        if (x > -200 && x < width + 20) boxes.push(x + 12 + tw > width && x - 12 - tw > 0 ? { id: a.id, x1: x - 12 - tw, x2: x + 7 } : { id: a.id, x1: x - 7, x2: x + 12 + tw });
      } else if (a.kind === 'span') {
        const x1 = yearToX(view, width, a.start);
        const x2 = yearToX(view, width, a.end);
        if (x2 > 0 && x1 < width) boxes.push({ id: a.id, x1: x1 - 2, x2: Math.max(x2, Math.max(x1, 4) + textWidth(a.title, 11.5)) + 2 });
      }
    }
    return packRows(boxes, 10);
  }, [annotations, view, width]);

  const annTop = AXIS_H;
  const annH = Math.max(1, annBoxes.count) * ANN_ROW + 6;
  const lanes: Lane[] = [];
  let y = annTop + annH + 6;
  for (const track of tracks) {
    const packed = packRows(track.phases.map((p) => ({ id: p.id, x1: p.start, x2: phaseEnd(p, nowYear) })), 0);
    const rowH = packed.count > 1 ? 15 : 22;
    const bandH = packed.count ? packed.count * rowH + (packed.count - 1) * 2 : 0;
    const bandTop = y + LANE_LABEL;
    const evTop = bandTop + bandH + (bandH ? 3 : 0);
    const bottom = evTop + (track.events.length ? EVENT_ROW : 0);
    lanes.push({ track, top: y, bandTop, rowH, rows: packed.rows, bandH, eventY: evTop + EVENT_ROW / 2, bottom });
    y = bottom + LANE_GAP;
  }
  const seriesLanes = series.map((s) => {
    const top = y;
    y = top + LANE_LABEL + SERIES_H + LANE_GAP;
    return { s, top, plotTop: top + LANE_LABEL, plotBottom: top + LANE_LABEL + SERIES_H };
  });
  const height = Math.max(y - LANE_GAP + PAD, 120);
  const laneOf = (id: string) => lanes.find((l) => l.track.id === id);

  const anchorY = (ref: ItemRef): number | null => {
    const lane = laneOf(ref.trackId);
    if (!lane) return null;
    if (lane.track.events.some((e) => e.id === ref.itemId)) return lane.eventY;
    const row = lane.rows.get(ref.itemId);
    return row === undefined ? null : lane.bandTop + row * (lane.rowH + 2) + lane.rowH / 2;
  };

  // ----- pointer handling -----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<
    | { mode: 'pan' | 'pending'; startX: number; lastX: number; target: Element | null }
    | { mode: 'edge'; trackId: string; itemId: string; edge: 'start' | 'end' }
    | { mode: 'pinch'; dist: number; mid: number }
    | null
  >(null);

  const localX = (clientX: number) => clientX - (svgRef.current?.getBoundingClientRect().left ?? 0);

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const x = localX(e.clientX);
    pointers.current.set(e.pointerId, { x, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { mode: 'pinch', dist: Math.max(Math.abs(a.x - b.x), 10), mid: (a.x + b.x) / 2 };
      return;
    }
    const target = e.target as Element;
    const edge = target.closest('[data-hit="edge"]') as SVGElement | null;
    if (edge) {
      drag.current = { mode: 'edge', trackId: edge.dataset.track ?? '', itemId: edge.dataset.item ?? '', edge: edge.dataset.edge === 'end' ? 'end' : 'start' };
      e.currentTarget.setPointerCapture(e.pointerId);
      setTip(null);
      return;
    }
    drag.current = { mode: 'pending', startX: x, lastX: x, target };
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const x = localX(e.clientX);
    const d = drag.current;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x, y: e.clientY });
    if (d?.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.max(Math.abs(a.x - b.x), 10);
      const mid = (a.x + b.x) / 2;
      const { dist: d0, mid: m0 } = d;
      setView((v) => {
        const z = zoomAround(v, xToYear(v, widthRef.current, m0), d0 / dist, limits);
        return pan(z, (-(mid - m0) / widthRef.current) * span(z), limits);
      });
      drag.current = { mode: 'pinch', dist, mid };
      return;
    }
    if (d?.mode === 'edge') {
      onRedate(d.trackId, d.itemId, d.edge, Math.round(xToYear(viewRef.current, widthRef.current, x)));
      setCross(xToYear(viewRef.current, widthRef.current, x));
      return;
    }
    if (d && (d.mode === 'pending' || d.mode === 'pan')) {
      if (d.mode === 'pending' && Math.abs(x - d.startX) > 4) {
        d.mode = 'pan';
        setPanning(true);
        setTip(null);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // the pointer may already be gone
        }
      }
      if (d.mode === 'pan') {
        const dx = x - d.lastX;
        d.lastX = x;
        setView((v) => pan(v, (-dx / widthRef.current) * span(v), limits));
        return;
      }
    }
    setCross(xToYear(viewRef.current, widthRef.current, x));
    if (e.pointerType === 'mouse' && !d) {
      const hit = (e.target as Element).closest('[data-hit="item"]') as SVGElement | null;
      const top = wrap.current?.getBoundingClientRect().top ?? 0;
      setTip(hit ? { trackId: hit.dataset.track ?? '', itemId: hit.dataset.item ?? '', x, y: e.clientY - top } : null);
    }
  };

  const endPointer = (e: RPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const d = drag.current;
    pointers.current.delete(e.pointerId);
    if (d?.mode === 'pinch') {
      if (pointers.current.size < 2) drag.current = null;
      pointers.current.clear();
      return;
    }
    drag.current = null;
    setPanning(false);
    if (cancelled || !d || d.mode !== 'pending') return;
    // A click: no movement since pointer down.
    const x = localX(e.clientX);
    const year = xToYear(viewRef.current, widthRef.current, x);
    setCross(year);
    const hit = d.target?.closest('[data-hit]') as SVGElement | null;
    const kind = hit?.dataset.hit;
    if (kind === 'item' && hit) {
      const lane = laneOf(hit.dataset.track ?? '');
      const p = lane?.track.phases.find((q) => q.id === hit.dataset.item);
      const edge = p && p.end !== null && Math.abs(year - p.end) < Math.abs(year - p.start) ? 'end' : 'start';
      onSelect({ type: 'item', trackId: hit.dataset.track ?? '', itemId: hit.dataset.item ?? '', edge });
    } else if (kind === 'ann' && hit) onSelect({ type: 'ann', id: hit.dataset.id ?? '' });
    else if (kind === 'lane' && hit) onStartAnnotation(Math.round(year), hit.dataset.track);
    else if (kind === 'zone') onStartAnnotation(Math.round(year));
    else onSelect(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const centre = (view.start + view.end) / 2;
    const step = span(view) * (e.shiftKey ? 0.5 : 0.1);
    if (e.key === 'ArrowLeft') setView((v) => pan(v, -step, limits));
    else if (e.key === 'ArrowRight') setView((v) => pan(v, step, limits));
    else if (e.key === '+' || e.key === '=') setView((v) => zoomAround(v, cross ?? centre, 0.8, limits));
    else if (e.key === '-' || e.key === '_') setView((v) => zoomAround(v, cross ?? centre, 1.25, limits));
    else if (e.key === '0') setView({ start: limits.min, end: limits.max });
    else return;
    e.preventDefault();
  };

  // ----- derived drawing data -----
  const tk = ticks(view, width, 56);
  const pairs = tracks.flatMap((t) => t.phases.map((p) => ({ color: t.color, kind: p.kind })));
  const crossYear = cross === null ? null : Math.round(cross);
  const rows = crossYear === null ? [] : readout(tracks, crossYear, nowYear).filter((r) => r.phases.length || r.events.length || r.near.length);
  const tipLane = tip ? laneOf(tip.trackId) : undefined;
  const selItem = selected?.type === 'item' ? selected : null;
  const selAnn = selected?.type === 'ann' ? selected.id : null;
  const todayX = X(today);

  const seriesAt = (s: Series, year: number) => {
    let best: { year: number; value: number } | null = null;
    for (const p of s.points) if (!best || Math.abs(p.year - year) < Math.abs(best.year - year)) best = p;
    return best && Math.abs(best.year - year) <= 1.5 ? best : null;
  };

  return (
    <>
      <div
        ref={wrap}
        className="timeline-wrap"
        tabIndex={0}
        role="group"
        aria-label={`Timeline from ${Math.round(view.start)} to ${Math.round(view.end)}. Arrow keys pan, plus and minus zoom, zero shows everything. The Tracks tab lists every item as text.`}
        onKeyDown={onKeyDown}
      >
        <svg
          ref={svgRef}
          className={panning ? 'panning' : undefined}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          fontSize={11.5}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endPointer(e, false)}
          onPointerCancel={(e) => endPointer(e, true)}
          onPointerLeave={(e) => {
            setTip(null);
            // A touch leaves when the finger lifts: keep the year it tapped.
            if (!drag.current && e.pointerType === 'mouse') setCross(null);
          }}
        >
          <KindDefs prefix="pt" pairs={pairs} />
          <defs>
            <clipPath id="plot-clip">
              <rect x={0} y={0} width={width} height={height} />
            </clipPath>
          </defs>
          <rect x={0} y={0} width={width} height={height} fill="var(--surface)" />

          {/* grid and axis */}
          {tk.years.map((yr) => (
            <g key={yr}>
              <line x1={X(yr)} x2={X(yr)} y1={AXIS_H - 6} y2={height} stroke="var(--grid)" strokeWidth={1} />
              <text x={X(yr)} y={14} textAnchor="middle" fill="var(--muted)" fontSize={11}>
                {yr}
              </text>
            </g>
          ))}
          <line x1={0} x2={width} y1={AXIS_H - 6} y2={AXIS_H - 6} stroke="var(--border)" />

          {/* annotation zone */}
          <rect data-hit="zone" x={0} y={annTop} width={width} height={annH} fill="var(--surface-2)" fillOpacity={0.5} />
          {annBoxes.count === 0 && (
            <text x={PAD} y={annTop + 18} fill="var(--muted)" fontSize={11.5} pointerEvents="none">
              {annotations.some((a) => a.kind !== 'link') ? 'No pins or spans in this range.' : width < 520 ? 'Your annotations go here. Tap to add one.' : 'Your annotations go here. Click this strip or a lane to add one.'}
            </text>
          )}

          {/* lanes */}
          {lanes.map((lane) => {
            const { track } = lane;
            const c = colorVar(track.color);
            const editable = !isBuiltin(track.id);
            let labelEnd = -Infinity;
            const evs = track.events.map((ev) => ({ ev, x: X(ev.year) })).filter((o) => o.x > -300 && o.x < width + 20);
            return (
              <g key={track.id} opacity={prefs[track.id]?.dimmed ? 0.32 : 1}>
                <rect data-hit="lane" data-track={track.id} x={0} y={lane.top} width={width} height={lane.bottom - lane.top} fill="var(--surface)" fillOpacity={0} />
                {track.phases.map((p) => {
                  const x1 = X(p.start);
                  const x2 = X(phaseEnd(p, today));
                  if (x2 < 0 || x1 > width) return null;
                  const row = lane.rows.get(p.id) ?? 0;
                  const yy = lane.bandTop + row * (lane.rowH + 2);
                  const w = Math.max(x2 - x1 - 2, 2);
                  const cx1 = Math.max(x1 + 1, 0);
                  const cx2 = Math.min(x1 + 1 + w, width);
                  const label = fitText(p.name, cx2 - cx1 - 10, 11);
                  const isSel = selItem?.trackId === track.id && selItem.itemId === p.id;
                  return (
                    <g key={p.id} data-hit="item" data-track={track.id} data-item={p.id}>
                      <rect x={x1 + 1} y={yy} width={w} height={lane.rowH} rx={3} {...kindFill('pt', track.color, p.kind)} />
                      {p.approximate && <rect x={x1 + 1.5} y={yy + 0.5} width={Math.max(w - 1, 1)} height={lane.rowH - 1} rx={3} fill="none" stroke={c} strokeWidth={1} strokeDasharray="3 3" />}
                      {p.end === null && x2 <= width && <path d={`M${x2 - 1},${yy} l5,${lane.rowH / 2} l-5,${lane.rowH / 2} Z`} fill={c} fillOpacity={0.6} />}
                      {isSel && <rect x={x1} y={yy - 1} width={w + 2} height={lane.rowH + 2} rx={4} fill="none" stroke="var(--text)" strokeWidth={2} />}
                      {label && (
                        <text x={cx1 + 5} y={yy + lane.rowH / 2 + 4} fontSize={11} fill="var(--text)" stroke="var(--surface)" strokeWidth={3} strokeOpacity={0.85} paintOrder="stroke" strokeLinejoin="round" pointerEvents="none">
                          {label}
                        </text>
                      )}
                    </g>
                  );
                })}
                {editable &&
                  track.phases.flatMap((p) => {
                    const row = lane.rows.get(p.id) ?? 0;
                    const yy = lane.bandTop + row * (lane.rowH + 2);
                    const edges: ('start' | 'end')[] = p.end === null ? ['start'] : ['start', 'end'];
                    return edges.map((edge) => {
                      const ex = X(edge === 'start' ? p.start : (p.end as number));
                      if (ex < -10 || ex > width + 10) return null;
                      return (
                        <g key={`${p.id}-${edge}`} data-hit="edge" data-track={track.id} data-item={p.id} data-edge={edge}>
                          <rect x={ex - 7} y={yy - 3} width={14} height={lane.rowH + 6} fill="var(--surface)" fillOpacity={0} />
                          <rect x={ex - 1.5} y={yy - 2} width={3} height={lane.rowH + 4} rx={1.5} fill="var(--text)" />
                        </g>
                      );
                    });
                  })}
                {evs.map(({ ev, x }, i) => {
                  const next = evs[i + 1]?.x ?? Infinity;
                  const room = Math.min(next - 9, width) - (x + 9);
                  const label = x + 9 > labelEnd ? fitText(ev.label, room, 11) : '';
                  if (label) labelEnd = x + 9 + textWidth(label, 11);
                  const isSel = selItem?.trackId === track.id && selItem.itemId === ev.id;
                  return (
                    <g key={ev.id} data-hit="item" data-track={track.id} data-item={ev.id}>
                      {lane.bandH > 0 && <line x1={x} x2={x} y1={lane.bandTop + lane.bandH} y2={lane.eventY} stroke={c} strokeWidth={1.5} />}
                      <circle cx={x} cy={lane.eventY} r={11} fill="var(--surface)" fillOpacity={0} />
                      {isSel && <circle cx={x} cy={lane.eventY} r={9} fill="none" stroke="var(--text)" strokeWidth={2} />}
                      <EventShape kind={ev.kind} x={x} y={lane.eventY} color={c} />
                      {label && (
                        <text x={x + 9} y={lane.eventY + 4} fontSize={11} fill="var(--muted)" stroke="var(--surface)" strokeWidth={3} strokeOpacity={0.85} paintOrder="stroke">
                          {label}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text x={PAD} y={lane.top + 12} fontSize={12} pointerEvents="none" stroke="var(--surface)" strokeWidth={4} strokeOpacity={0.9} paintOrder="stroke" strokeLinejoin="round">
                  <tspan fill="var(--text)" fontWeight={700}>{fitText(track.name, width - 2 * PAD, 12.5)}</tspan>
                  {textWidth(track.name, 12.5) + textWidth(track.author, 11.5) + 30 < width && <tspan fill="var(--muted)" fontSize={11.5}>{`  ${track.author}`}</tspan>}
                </text>
              </g>
            );
          })}

          {/* data series, each in its own lane with its own value axis */}
          {seriesLanes.map(({ s, top, plotTop, plotBottom }) => {
            const sc = yScale(s.points.map((p) => p.value), s.log);
            const c = colorVar(s.color);
            const Y = (v: number) => plotBottom - 4 - (sc ? sc.at(v) : 0) * (SERIES_H - 8);
            const pts = sc ? s.points.filter((p) => !Number.isNaN(sc.at(p.value))) : [];
            const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.year).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
            const near = crossYear === null || cross === null ? null : seriesAt(s, cross);
            return (
              <g key={s.id}>
                <line x1={0} x2={width} y1={plotBottom} y2={plotBottom} stroke="var(--border)" />
                <g clipPath="url(#plot-clip)">
                  {pts.length > 1 && <path d={d} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
                  {pts.length === 1 && <circle cx={X(pts[0].year)} cy={Y(pts[0].value)} r={4} fill={c} />}
                  {near && sc && !Number.isNaN(sc.at(near.value)) && <circle cx={X(near.year)} cy={Y(near.value)} r={4.5} fill={c} stroke="var(--surface)" strokeWidth={2} />}
                </g>
                <text x={PAD} y={top + 12} fontSize={12} stroke="var(--surface)" strokeWidth={4} strokeOpacity={0.9} paintOrder="stroke" pointerEvents="none">
                  <tspan fill="var(--text)" fontWeight={700}>{fitText(s.name, width - 2 * PAD - 110, 12.5)}</tspan>
                  <tspan fill="var(--muted)" fontSize={11.5}>{`  ${s.log ? 'log scale' : 'linear scale'}`}</tspan>
                </text>
                {sc && (
                  <g fontSize={10.5} fill="var(--muted)" textAnchor="end" stroke="var(--surface)" strokeWidth={3} strokeOpacity={0.85} paintOrder="stroke" pointerEvents="none">
                    <text x={width - PAD} y={plotTop + 10}>{fmt(sc.max)}</text>
                    <text x={width - PAD} y={plotBottom - 5}>{fmt(sc.min)}</text>
                  </g>
                )}
                {!sc && (
                  <text x={PAD} y={plotTop + 30} fill="var(--muted)">
                    {s.log ? 'No positive values to draw on a log scale.' : 'No points.'}
                  </text>
                )}
              </g>
            );
          })}

          {/* today */}
          {todayX >= 0 && todayX <= width && (
            <g pointerEvents="none">
              <line x1={todayX} x2={todayX} y1={AXIS_H - 6} y2={height} stroke="var(--text)" strokeWidth={1.2} />
              <text x={Math.min(todayX + 4, width - 34)} y={height - 3} fontSize={10.5} fontWeight={700} fill="var(--text)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">
                today
              </text>
            </g>
          )}

          {/* links between lanes */}
          {annotations.map((a) => {
            if (a.kind !== 'link') return null;
            const l = linkLag(tracks, a.from, a.to, nowYear);
            const y1 = anchorY(a.from);
            const y2 = anchorY(a.to);
            if (!l || y1 === null || y2 === null) return null;
            const x1 = X(l.from.year);
            const x2 = X(l.to.year);
            if (Math.max(x1, x2) < 0 || Math.min(x1, x2) > width) return null;
            const my = (y1 + y2) / 2;
            const mx = (x1 + x2) / 2;
            const sel = selAnn === a.id;
            const text = `${l.lag > 0 ? '+' : ''}${l.lag} y`;
            const tw = textWidth(text, 11) + 12;
            return (
              <g key={a.id} data-hit="ann" data-id={a.id} opacity={a.status === 'dropped' ? 0.45 : 1}>
                <path d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`} fill="none" stroke="var(--surface)" strokeWidth={10} strokeOpacity={0} />
                <path d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`} fill="none" stroke={sel ? 'var(--accent)' : 'var(--text)'} strokeWidth={sel ? 2.5 : 1.6} strokeDasharray={a.status === 'hunch' ? '5 4' : undefined} />
                <circle cx={x1} cy={y1} r={4} fill="var(--text)" stroke="var(--surface)" strokeWidth={1.5} />
                <path d={`M${x2 - 5},${y2 + (y2 > y1 ? -7 : 7)} L${x2},${y2} L${x2 + 5},${y2 + (y2 > y1 ? -7 : 7)}`} fill="none" stroke={sel ? 'var(--accent)' : 'var(--text)'} strokeWidth={1.8} />
                <rect x={mx - tw / 2} y={my - 9} width={tw} height={18} rx={9} fill="var(--surface)" stroke={sel ? 'var(--accent)' : 'var(--text)'} strokeWidth={sel ? 2 : 1} />
                <text x={mx} y={my + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text)" textDecoration={a.status === 'dropped' ? 'line-through' : undefined}>
                  {text}
                </text>
              </g>
            );
          })}

          {/* pins and spans */}
          {annotations.map((a) => {
            if (a.kind === 'link') return null;
            const row = annBoxes.rows.get(a.id);
            if (row === undefined) return null;
            const ry = annTop + 3 + row * ANN_ROW;
            const sel = selAnn === a.id;
            const ink = sel ? 'var(--accent)' : 'var(--text)';
            const lane = a.trackId ? laneOf(a.trackId) : undefined;
            const stemEnd = lane ? lane.bottom : height - PAD;
            const dropped = a.status === 'dropped';
            const textProps = { fontSize: 11.5, fontWeight: 600, fill: ink, textDecoration: dropped ? 'line-through' : undefined, stroke: 'var(--surface)', strokeWidth: 3, strokeOpacity: 0.8, paintOrder: 'stroke' as const };
            if (a.kind === 'pin') {
              const x = X(a.year);
              const tw = textWidth(a.title, 11.5);
              const flip = x + 12 + tw > width && x - 12 - tw > 0;
              return (
                <g key={a.id} data-hit="ann" data-id={a.id} opacity={dropped ? 0.5 : 1}>
                  <line x1={x} x2={x} y1={ry + 11} y2={stemEnd} stroke={ink} strokeWidth={sel ? 1.5 : 1} strokeOpacity={sel ? 0.9 : 0.35} pointerEvents="none" />
                  <rect x={flip ? x - 12 - tw : x - 9} y={ry} width={21 + tw} height={ANN_ROW - 2} fill="var(--surface)" fillOpacity={0} />
                  <StatusGlyph status={a.status} x={x} y={ry + 10} color={ink} />
                  <text x={flip ? x - 10 : x + 10} y={ry + 14} textAnchor={flip ? 'end' : 'start'} {...textProps}>{flip ? a.title : fitText(a.title, Math.max(width - x - 12, 40), 11.5)}</text>
                </g>
              );
            }
            const x1 = X(a.start);
            const x2 = X(a.end);
            const lx = Math.max(x1, 4);
            return (
              <g key={a.id} data-hit="ann" data-id={a.id} opacity={dropped ? 0.5 : 1}>
                {sel && <rect x={x1} y={ry + 18} width={x2 - x1} height={stemEnd - ry - 18} fill="var(--accent)" fillOpacity={0.07} pointerEvents="none" />}
                <rect x={x1} y={ry} width={Math.max(x2 - x1, textWidth(a.title, 11.5))} height={ANN_ROW - 2} fill="var(--surface)" fillOpacity={0} />
                <path d={`M${x1},${ry + 20} v-4 H${x2} v4`} fill="none" stroke={ink} strokeWidth={sel ? 2.2 : 1.6} strokeDasharray={a.status === 'hunch' ? '5 4' : undefined} />
                <text x={lx + 2} y={ry + 12} {...textProps}>{a.title}</text>
              </g>
            );
          })}

          {/* crosshair */}
          {cross !== null && crossYear !== null && (
            <g pointerEvents="none" data-noexport="1">
              <line x1={X(cross)} x2={X(cross)} y1={AXIS_H - 6} y2={height} stroke="var(--muted)" strokeWidth={1} />
              <rect x={Math.min(Math.max(X(cross) - 20, 0), width - 40)} y={1} width={40} height={18} rx={6} fill="var(--text)" />
              <text x={Math.min(Math.max(X(cross), 20), width - 20)} y={14} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="var(--surface)">
                {crossYear}
              </text>
            </g>
          )}
        </svg>
        {tip && tipLane && (
          <div className="tip" style={{ left: Math.min(Math.max(tip.x + 14, 8), Math.max(width - 268, 8)), top: Math.max(tip.y + 16, 0) }}>
            <ItemCard track={tipLane.track} phase={tipLane.track.phases.find((p) => p.id === tip.itemId)} event={tipLane.track.events.find((e) => e.id === tip.itemId)} nowYear={nowYear} />
          </div>
        )}
      </div>

      <div className="readout">
        {crossYear === null ? (
          <span className="muted">Move over the timeline, or tap it, to read across every lane at one year.</span>
        ) : (
          <>
            <b>In {crossYear}</b>
            {rows.length === 0 && !series.length && <span className="muted">: nothing dated on the visible tracks.</span>}
            <ul>
              {rows.map((r) => (
                <li key={r.trackId}>
                  <span className="key" style={{ background: colorVar(tracks.find((t) => t.id === r.trackId)?.color ?? 8) }} />
                  <span>
                    <span className="strong">{r.trackName}</span> <span className="muted">({r.author})</span>: {readoutClause(r)}
                  </span>
                </li>
              ))}
              {series.map((s) => {
                const p = cross === null ? null : seriesAt(s, cross);
                return p ? (
                  <li key={s.id}>
                    <span className="key" style={{ background: colorVar(s.color) }} />
                    <span>
                      <span className="strong">{s.name}</span>: <span className="num">{fmt(p.value)}</span> <span className="muted">({Math.round(p.year * 10) / 10})</span>
                    </span>
                  </li>
                ) : null;
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
