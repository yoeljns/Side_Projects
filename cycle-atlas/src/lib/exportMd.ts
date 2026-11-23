// The markdown summary for the essay: what is in view, the annotations that
// fall inside it, and the theory notes. Bodies are already markdown-ish, so
// they are passed through as written.
import { readout, readoutClause, sampleNote, whereNow } from './analysis';
import { allTracks, annotationYears, lagPhrase, linkLag, phaseEnd } from './model';
import type { View } from './scale';
import { KIND_LABEL, type Annotation, type AtlasDoc, type Track } from './types';

const yr = (y: number, approx?: boolean): string => `${approx ? 'c. ' : ''}${y}`;

function annotationLine(a: Annotation, tracks: Track[], nowYear: number): string {
  if (a.kind === 'pin') return `${a.year}`;
  if (a.kind === 'span') return `${a.start} to ${a.end}`;
  const l = linkLag(tracks, a.from, a.to, nowYear);
  if (!l) return 'link to an item that no longer exists';
  return `${l.from.trackName}: ${l.from.label} (${l.from.year}) ${lagPhrase(l.lag)} ${l.to.trackName}: ${l.to.label} (${l.to.year})`;
}

export interface SummaryInput {
  doc: AtlasDoc;
  /** The tracks on screen, in lane order. */
  tracks: Track[];
  view: View;
  today: string;
  /** Include ideas marked as dropped (under their own heading). */
  includeDropped: boolean;
}

export function markdownSummary({ doc, tracks, view, today, includeDropped }: SummaryInput): string {
  const nowYear = Number(today.slice(0, 4));
  // Links may point at hidden tracks, so they are resolved against every track.
  const every = allTracks(doc);
  const from = Math.floor(view.start);
  const to = Math.ceil(view.end);
  const out: string[] = [];
  out.push(`# Cycle atlas: ${from} to ${to}`, '', `Exported ${today}. Chronologies are each author's periodisation, not established fact; "c." marks dates that are approximate or disputed.`, '');

  out.push('## Tracks in view', '');
  for (const t of tracks) {
    const phases = t.phases.filter((p) => p.start < to && phaseEnd(p, nowYear) > from);
    const events = t.events.filter((e) => e.year >= from && e.year <= to);
    if (!phases.length && !events.length) continue;
    out.push(`### ${t.name} (${t.author})`, '');
    for (const p of phases) {
      out.push(`- ${yr(p.start, p.approximate)} to ${p.end === null ? 'now' : yr(p.end, p.approximate)}: ${p.name} [${KIND_LABEL[p.kind].toLowerCase()}]. Source: ${p.source}.`);
    }
    for (const e of events) out.push(`- ${yr(e.year, e.approximate)}: ${e.label}. Source: ${e.source}.`);
    out.push('');
  }

  const inView = doc.annotations.filter((a) => {
    const y = annotationYears(a, every, nowYear);
    return y ? y.end >= from && y.start <= to : true;
  });
  const section = (title: string, list: Annotation[]) => {
    if (!list.length) return;
    out.push(`## ${title}`, '');
    for (const a of list) {
      out.push(`### ${a.title}`, '');
      out.push(`*${a.kind}, ${annotationLine(a, every, nowYear)}. Status: ${a.status}. Confidence: ${a.confidence}.${a.tags.length ? ` Tags: ${a.tags.map((t) => `#${t}`).join(' ')}.` : ''}*`, '');
      if (a.body.trim()) out.push(a.body.trim(), '');
      if (a.log.length > 1) out.push(`History: ${a.log.map((l) => `${l.on} ${l.change}`).join('; ')}.`, '');
    }
  };
  section('Annotations', inView.filter((a) => a.status !== 'dropped'));
  if (includeDropped) section('Dropped ideas', inView.filter((a) => a.status === 'dropped'));

  if (doc.notes.length) {
    out.push('## Theory notes', '');
    for (const n of [...doc.notes].sort((a, b) => a.date.localeCompare(b.date))) {
      out.push(`### ${n.date}${n.title ? `: ${n.title}` : ''}`, '');
      if (n.body.trim()) out.push(n.body.trim(), '');
      const refs = n.refs.map((id) => doc.annotations.find((a) => a.id === id)?.title).filter(Boolean);
      if (refs.length) out.push(`Refers to: ${refs.join('; ')}.`, '');
    }
  }

  out.push(`## Where each track is in ${nowYear}`, '');
  for (const t of tracks) {
    for (const r of whereNow(t, nowYear).rows) {
      const h = r.history;
      const hist = h ? `earlier ${KIND_LABEL[r.phase.kind].toLowerCase()} phases on this track lasted ${h.min} to ${h.max} years, mean ${h.mean.toFixed(1)} (${sampleNote(h.n)})` : 'no earlier phase of this kind to compare with';
      out.push(`- ${t.name} (${t.author}): ${r.phase.name}, ${r.yearsIn} years in; ${hist}.`);
    }
  }
  out.push('');

  const mid = Math.round((view.start + view.end) / 2);
  const rows = readout(tracks, mid, nowYear).filter((r) => r.phases.length || r.events.length);
  if (rows.length) {
    out.push(`## Cross-section at ${mid}`, '');
    for (const r of rows) out.push(`- ${r.trackName} (${r.author}): ${readoutClause({ ...r, near: [] })}.`);
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
