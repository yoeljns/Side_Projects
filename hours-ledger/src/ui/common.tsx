import { useEffect, useRef, useState } from 'react';
import { fmtDur, fmtHours, weekdayName, weekdayShort, type Day } from '../lib/dates';
import { PALETTE_SIZE, type Category } from '../lib/model';
import type { DayRow } from '../lib/summary';

export const catColor = (index: number) => `var(--c${((index % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE})`;
export const onColor = (index: number) => (index % PALETTE_SIZE === 3 ? 'var(--on-c3)' : 'var(--on-fill)');

export interface Part {
  id: string;
  label: string;
  color: number;
}

export const partsOf = (cats: Category[]): Part[] => cats.map((c) => ({ id: c.id, label: c.label, color: c.color }));

export function Dot({ color }: { color: number }) {
  return <i className="dot" style={{ background: catColor(color) }} aria-hidden="true" />;
}

export function Legend({ parts, values }: { parts: Part[]; values?: Record<string, string> }) {
  return (
    <div className="legend">
      {parts.map((p) => (
        <span key={p.id}>
          <Dot color={p.color} />
          {p.label}
          {values?.[p.id] && <b className="num">{values[p.id]}</b>}
        </span>
      ))}
    </div>
  );
}

/** Seven stacked columns, Monday to Sunday. Pass `onPick` to make the days tappable. */
export function DayBars(props: { days: DayRow[]; parts: Part[]; today: Day; selected?: Day; onPick?: (d: Day) => void; height?: number }) {
  const { days, parts, today, selected, onPick, height = 48 } = props;
  // Four hours is the smallest full-height day, so a single 15 minutes does not fill the plot.
  const max = Math.max(240, ...days.map((d) => d.total));
  return (
    <div className="daybars" style={{ ['--bar-h' as string]: `${height}px` }}>
      {days.map((d) => {
        const future = d.day > today;
        const label = `${weekdayName(d.day)}: ${d.total > 0 ? fmtDur(d.total) : 'nothing logged'}${
          d.total > 0 ? ` (${parts.filter((p) => d.byCategory[p.id]).map((p) => `${p.label} ${fmtDur(d.byCategory[p.id])}`).join(', ')})` : ''
        }`;
        const cls = `col${d.day === today ? ' is-today' : ''}${d.day === selected ? ' sel' : ''}${future ? ' future' : ''}`;
        const body = (
          <>
            <span className="plot">
              <span className="stack">
                {parts.map((p) => {
                  const m = d.byCategory[p.id] ?? 0;
                  return m > 0 ? <i key={p.id} style={{ height: Math.max(2, (m / max) * height), background: catColor(p.color) }} /> : null;
                })}
              </span>
            </span>
            <span className="d">{weekdayShort(d.day)}</span>
            <span className="v">{d.total > 0 ? fmtHours(d.total) : future ? '' : '–'}</span>
          </>
        );
        return onPick && !future ? (
          <button key={d.day} type="button" className={cls} title={label} aria-label={label} aria-pressed={d.day === selected} onClick={() => onPick(d.day)}>
            {body}
          </button>
        ) : (
          <div key={d.day} className={cls} title={label} role="img" aria-label={label}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** One bar for the whole week, split by category; the share is printed inside blocks wide enough to hold it. */
export function SegBar({ rows }: { rows: { id: string; label: string; color: number; minutes: number; share: number }[] }) {
  const live = rows.filter((r) => r.minutes > 0);
  if (live.length === 0) return <div className="segbar empty" role="img" aria-label="Nothing tracked" />;
  return (
    <div className="segbar" role="img" aria-label={live.map((r) => `${r.label} ${fmtDur(r.minutes)}, ${Math.round(r.share * 100)}%`).join('; ')}>
      {live.map((r) => (
        <div key={r.id} title={`${r.label}: ${fmtDur(r.minutes)}, ${Math.round(r.share * 100)}%`} style={{ flex: `${r.minutes} 1 0`, background: catColor(r.color), color: onColor(r.color) }}>
          {r.share >= 0.13 ? `${Math.round(r.share * 100)}%` : ''}
        </div>
      ))}
    </div>
  );
}

export function download(filename: string, text: string, mime: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** The element's width in CSS pixels, so charts are drawn at their real size and text never scales. */
export function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.floor(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** A text box that commits on Enter or blur and snaps back if the parent rejects the value. */
export function CommitInput(props: { value: string; onCommit: (v: string) => boolean; label: string; className?: string; placeholder?: string; inputMode?: 'text' | 'decimal' }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    if (draft === props.value) return;
    if (!props.onCommit(draft)) setDraft(props.value);
  };
  return (
    <input
      className={props.className}
      aria-label={props.label}
      placeholder={props.placeholder}
      inputMode={props.inputMode}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(props.value);
      }}
    />
  );
}
