// Shared SVG pieces: the fill for each phase kind (pattern as well as tint, so
// kind never rests on colour alone), the event shapes and the status glyphs.
import type { ReactNode } from 'react';
import { KIND_LABEL, type CycleEvent, type EventKind, type Phase, type PhaseKind, type Status, type Track } from '../lib/types';

export const colorVar = (i: number): string => `var(--s${Math.min(Math.max(i, 0), 8)})`;

const PATTERNED: PhaseKind[] = ['contraction', 'trough', 'installation', 'turning', 'deployment', 'crisis'];
const SOLID_OPACITY: Partial<Record<PhaseKind, number>> = { expansion: 0.6, peak: 0.95, regime: 0.16, other: 0.32 };

export const patternId = (prefix: string, color: number, kind: PhaseKind): string => `${prefix}-${color}-${kind}`;

/** Fill attributes for a phase band. */
export function kindFill(prefix: string, color: number, kind: PhaseKind): { fill: string; fillOpacity?: number } {
  if (PATTERNED.includes(kind)) return { fill: `url(#${patternId(prefix, color, kind)})` };
  return { fill: colorVar(color), fillOpacity: SOLID_OPACITY[kind] ?? 0.4 };
}

function patternBody(kind: PhaseKind, c: string): ReactNode {
  const line = { stroke: c, strokeWidth: 1.4, strokeLinecap: 'square' as const };
  switch (kind) {
    case 'contraction':
      return <path d="M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6" {...line} />;
    case 'installation':
      return <path d="M-2,6 L2,10 M0,0 L8,8 M6,-2 L10,2" {...line} />;
    case 'turning':
      return <path d="M0,8 L8,0 M0,0 L8,8" {...line} strokeWidth={1.2} />;
    case 'deployment':
      return <path d="M0,4 L8,4" {...line} />;
    case 'crisis':
      return <path d="M4,0 L4,8" {...line} />;
    case 'trough':
      return (
        <>
          <circle cx="2" cy="2" r="1.3" fill={c} />
          <circle cx="6" cy="6" r="1.3" fill={c} />
        </>
      );
    default:
      return null;
  }
}

/** Pattern definitions for every colour and kind pair in use. */
export function KindDefs({ prefix, pairs }: { prefix: string; pairs: { color: number; kind: PhaseKind }[] }) {
  const seen = new Set<string>();
  const out: ReactNode[] = [];
  for (const { color, kind } of pairs) {
    const id = patternId(prefix, color, kind);
    if (seen.has(id) || !PATTERNED.includes(kind)) continue;
    seen.add(id);
    const c = colorVar(color);
    out.push(
      <pattern key={id} id={id} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill={c} fillOpacity={0.14} />
        {patternBody(kind, c)}
      </pattern>,
    );
  }
  return <defs>{out}</defs>;
}

/** Event marker: the shape carries the kind. Drawn with a surface ring so it stays clear over a band. */
export function EventShape({ kind, x, y, color, r = 5 }: { kind: EventKind; x: number; y: number; color: string; r?: number }) {
  const ring = { stroke: 'var(--surface)', strokeWidth: 1.5 };
  switch (kind) {
    case 'peak':
      return <path d={`M${x},${y - r} L${x + r},${y + r - 1} L${x - r},${y + r - 1} Z`} fill={color} {...ring} />;
    case 'trough':
      return <path d={`M${x},${y + r} L${x + r},${y - r + 1} L${x - r},${y - r + 1} Z`} fill={color} {...ring} />;
    case 'start':
      return <path d={`M${x},${y - r - 0.5} L${x + r + 0.5},${y} L${x},${y + r + 0.5} L${x - r - 0.5},${y} Z`} fill={color} {...ring} />;
    case 'crisis':
      return (
        <g>
          <path d={`M${x - r + 1},${y - r + 1} L${x + r - 1},${y + r - 1} M${x - r + 1},${y + r - 1} L${x + r - 1},${y - r + 1}`} stroke="var(--surface)" strokeWidth={5} strokeLinecap="round" />
          <path d={`M${x - r + 1},${y - r + 1} L${x + r - 1},${y + r - 1} M${x - r + 1},${y + r - 1} L${x + r - 1},${y - r + 1}`} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
        </g>
      );
    case 'shock':
      return <rect x={x - r + 0.5} y={y - r + 0.5} width={2 * r - 1} height={2 * r - 1} fill={color} {...ring} />;
    default:
      return <circle cx={x} cy={y} r={r - 0.5} fill={color} {...ring} />;
  }
}

/** Annotation marker: the glyph carries the status (hollow, filled, ringed, struck). */
export function StatusGlyph({ status, x, y, color = 'var(--text)' }: { status: Status; x: number; y: number; color?: string }) {
  switch (status) {
    case 'hunch':
      return <circle cx={x} cy={y} r={4} fill="var(--surface)" stroke={color} strokeWidth={1.6} />;
    case 'claim':
      return <circle cx={x} cy={y} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={1.2} />;
    case 'tested':
      return (
        <g>
          <circle cx={x} cy={y} r={5.5} fill="var(--surface)" stroke={color} strokeWidth={1.4} />
          <circle cx={x} cy={y} r={2.6} fill={color} />
        </g>
      );
    default:
      return (
        <g>
          <circle cx={x} cy={y} r={4} fill="var(--surface)" stroke={color} strokeWidth={1.2} />
          <path d={`M${x - 5},${y + 5} L${x + 5},${y - 5}`} stroke={color} strokeWidth={1.4} />
        </g>
      );
  }
}

export const years = (p: Phase): string => `${p.approximate ? 'c. ' : ''}${p.start} to ${p.end === null ? 'now' : p.end}`;

/** The text of a detail card for a phase or event: what it is, when, whose dating, and the citation. */
export function ItemCard({ track, phase, event, nowYear }: { track: Track; phase?: Phase; event?: CycleEvent; nowYear: number }) {
  const item = phase ?? event;
  if (!item) return null;
  return (
    <>
      <div className="strong">{phase ? phase.name : event?.label}</div>
      <div className="num">
        {phase ? (
          <>
            {years(phase)} · {(phase.end ?? nowYear) - phase.start} years{phase.end === null ? ' so far' : ''} · {KIND_LABEL[phase.kind]}
          </>
        ) : (
          <>
            {event?.approximate ? 'c. ' : ''}
            {event?.year} · {event?.kind} event
          </>
        )}
      </div>
      <div className="muted">
        {track.name} · {track.author}
      </div>
      {item.approximate && <div><span className="chip warn">Approximate date</span></div>}
      {item.note && <div>{item.note}</div>}
      <div className="cite">Source: {item.source || 'none given'}</div>
    </>
  );
}
