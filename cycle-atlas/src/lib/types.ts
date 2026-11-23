// Shapes shared by the model, the analysis helpers and the UI. Years are plain
// numbers (whole years for phases and events, decimals allowed in data series).

export const PHASE_KINDS = [
  'expansion',
  'peak',
  'contraction',
  'trough',
  'installation',
  'turning',
  'deployment',
  'crisis',
  'regime',
  'other',
] as const;
export type PhaseKind = (typeof PHASE_KINDS)[number];

export const KIND_LABEL: Record<PhaseKind, string> = {
  expansion: 'Expansion',
  peak: 'Peak',
  contraction: 'Contraction',
  trough: 'Trough',
  installation: 'Installation',
  turning: 'Turning point',
  deployment: 'Deployment',
  crisis: 'Crisis cluster',
  regime: 'Regime',
  other: 'Other',
};

export const EVENT_KINDS = ['start', 'peak', 'trough', 'crisis', 'shock', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  start: 'Start',
  peak: 'Peak',
  trough: 'Trough',
  crisis: 'Crisis',
  shock: 'Shock',
  other: 'Other',
};

export type TrackGroup = 'technology' | 'debt' | 'commodities' | 'context' | 'own';

export interface Phase {
  id: string;
  name: string;
  start: number;
  /** null means still running. */
  end: number | null;
  kind: PhaseKind;
  source: string;
  note?: string;
  /** The date is a judgement call, or sources disagree. Shown with a "c." and a dashed outline. */
  approximate?: boolean;
}

export interface CycleEvent {
  id: string;
  year: number;
  label: string;
  kind: EventKind;
  source: string;
  note?: string;
  approximate?: boolean;
}

export interface Track {
  id: string;
  name: string;
  /** Whose chronology this is. */
  author: string;
  group: TrackGroup;
  description?: string;
  /** Index into the fixed palette, 0..8 (8 is neutral grey). */
  color: number;
  phases: Phase[];
  events: CycleEvent[];
  /** Set on the owner's copy of a built-in track. */
  copiedFrom?: string;
}

export interface TrackPref {
  hidden?: boolean;
  dimmed?: boolean;
}

export const STATUSES = ['hunch', 'claim', 'tested', 'dropped'] as const;
export type Status = (typeof STATUSES)[number];
export const CONFIDENCES = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** Points at a dated thing on a track: an event, or one edge of a phase. */
export interface ItemRef {
  trackId: string;
  itemId: string;
  edge?: 'start' | 'end';
}

export interface AnnotationBase {
  id: string;
  title: string;
  body: string;
  tags: string[];
  confidence: Confidence;
  status: Status;
  createdOn: string;
  updatedOn: string;
  /** Status and confidence changes, oldest first, so the path of an idea stays on record. */
  log: { on: string; change: string }[];
}
export interface PinAnnotation extends AnnotationBase {
  kind: 'pin';
  year: number;
  trackId?: string;
}
export interface SpanAnnotation extends AnnotationBase {
  kind: 'span';
  start: number;
  end: number;
  trackId?: string;
}
export interface LinkAnnotation extends AnnotationBase {
  kind: 'link';
  from: ItemRef;
  to: ItemRef;
}
export type Annotation = PinAnnotation | SpanAnnotation | LinkAnnotation;

export interface TheoryNote {
  id: string;
  date: string;
  title: string;
  body: string;
  /** Annotation ids this entry talks about. */
  refs: string[];
}

export interface SeriesPoint {
  year: number;
  value: number;
}
export interface Series {
  id: string;
  name: string;
  source: string;
  log: boolean;
  /** Palette index, as for tracks. */
  color: number;
  hidden?: boolean;
  points: SeriesPoint[];
}

export interface AtlasDoc {
  /** The owner's tracks, including edited copies of built-in ones. */
  tracks: Track[];
  /** Show, hide or dim any track, built-in or own, by id. */
  trackPrefs: Record<string, TrackPref>;
  annotations: Annotation[];
  notes: TheoryNote[];
  series: Series[];
}

export const BLANK_DOC: AtlasDoc = { tracks: [], trackPrefs: {}, annotations: [], notes: [], series: [] };

export const PALETTE_NAMES = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Magenta', 'Green', 'Violet', 'Red', 'Grey'] as const;
export const MIN_YEAR = 1700;
