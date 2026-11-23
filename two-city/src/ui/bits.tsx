import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Doc } from '../lib/model.ts';
import type { Day } from '../lib/dates.ts';

/** What every tab receives. `today` is the date in the city the app is switched to. */
export interface TabProps {
  doc: Doc;
  update: (fn: (d: Doc) => Doc) => void;
  today: Day;
  now: Date;
}

export function download(filename: string, text: string, mime: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const downloadIcs = (filename: string, text: string) => download(filename, text, 'text/calendar;charset=utf-8');

/** The current time, refreshed every half minute and when the tab comes back. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field${className ? ` ${className}` : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** A button that reads a text file and hands over its contents. */
export function FileButton({ label, accept, onText }: { label: string; accept: string; onText: (text: string, name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn" onClick={() => ref.current?.click()}>{label}</button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then((t) => onText(t, f.name));
          e.target.value = '';
        }}
      />
    </>
  );
}

/** Whole-number input that allows an empty value. */
export function NumberInput({ value, onChange, label, min = 0, className, placeholder }: { value: number | null; onChange: (n: number | null) => void; label: string; min?: number; className?: string; placeholder?: string }) {
  return (
    <input
      aria-label={label}
      className={className ?? 'narrow num'}
      type="number"
      inputMode="numeric"
      min={min}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => {
        const n = e.target.value === '' ? null : Math.round(Number(e.target.value));
        onChange(n === null || Number.isNaN(n) ? null : Math.max(min, n));
      }}
    />
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${Math.abs(n) === 1 ? one : many}`;
