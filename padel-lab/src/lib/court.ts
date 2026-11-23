// Court model. All positions are in metres.
//   x: across the court, 0 (left wall) .. 10 (right wall), as seen from the camera
//   y: along the court, 0 (back wall on the camera side) .. 20 (far back wall)
// The net is at y = 10.

export const COURT_W = 10;
export const COURT_L = 20;
export const NET_Y = 10;
export const SERVICE_FROM_NET = 6.95;
export const NEAR_SERVICE_Y = NET_Y - SERVICE_FROM_NET; // 3.05
export const FAR_SERVICE_Y = NET_Y + SERVICE_FROM_NET; // 16.95

/** A player counts as "at the net" within this distance of it. */
export const NET_ZONE_M = 4;
/** Between the net zone and this distance is the transition zone; beyond is the back. */
export const MID_ZONE_M = 7;

export type Pt = { x: number; y: number };
export type Zone = 'net' | 'mid' | 'back';
export const ZONES: Zone[] = ['net', 'mid', 'back'];
export const ZONE_LABEL: Record<Zone, string> = {
  net: 'At the net',
  mid: 'Transition',
  back: 'Back of court',
};

export function zoneOf(y: number): Zone {
  const d = Math.abs(y - NET_Y);
  return d <= NET_ZONE_M ? 'net' : d <= MID_ZONE_M ? 'mid' : 'back';
}

export type Team = 'near' | 'far';
export const teamOf = (y: number): Team => (y < NET_Y ? 'near' : 'far');

/** Heatmap grid: 0.5 m cells. */
export const CELL = 0.5;
export const GRID_W = COURT_W / CELL; // 20
export const GRID_L = COURT_L / CELL; // 40

export function cellIndex(p: Pt): number {
  const cx = Math.min(GRID_W - 1, Math.max(0, Math.floor(p.x / CELL)));
  const cy = Math.min(GRID_L - 1, Math.max(0, Math.floor(p.y / CELL)));
  return cy * GRID_W + cx;
}

/**
 * Calibration presets: which four floor points the user taps.
 * Order is always near-left, near-right, far-right, far-left.
 */
export type PresetId = 'service' | 'nearServiceFar' | 'full' | 'farHalf';

export type Preset = {
  id: PresetId;
  name: string;
  hint: string;
  points: [Pt, Pt, Pt, Pt];
  labels: [string, string, string, string];
};

const rect = (y0: number, y1: number): [Pt, Pt, Pt, Pt] => [
  { x: 0, y: y0 },
  { x: COURT_W, y: y0 },
  { x: COURT_W, y: y1 },
  { x: 0, y: y1 },
];

export const PRESETS: Preset[] = [
  {
    id: 'service',
    name: 'Service line to service line',
    hint: 'Best default: where each service line meets the side walls.',
    points: rect(NEAR_SERVICE_Y, FAR_SERVICE_Y),
    labels: [
      'Near service line × left wall',
      'Near service line × right wall',
      'Far service line × right wall',
      'Far service line × left wall',
    ],
  },
  {
    id: 'nearServiceFar',
    name: 'Near service line to far back wall',
    hint: 'Use when the far service line is hard to see.',
    points: rect(NEAR_SERVICE_Y, COURT_L),
    labels: [
      'Near service line × left wall',
      'Near service line × right wall',
      'Far right corner (floor)',
      'Far left corner (floor)',
    ],
  },
  {
    id: 'full',
    name: 'Full court corners',
    hint: 'Only if all four floor corners are in frame (high camera).',
    points: rect(0, COURT_L),
    labels: [
      'Near left corner (floor)',
      'Near right corner (floor)',
      'Far right corner (floor)',
      'Far left corner (floor)',
    ],
  },
  {
    id: 'farHalf',
    name: 'Net to far back wall',
    hint: 'Net post bases and the far corners. Least accurate for the near side.',
    points: rect(NET_Y, COURT_L),
    labels: [
      'Left net post (floor)',
      'Right net post (floor)',
      'Far right corner (floor)',
      'Far left corner (floor)',
    ],
  },
];

export const presetById = (id: PresetId): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** Line segments of the court markings, for drawing. */
export const COURT_LINES: [Pt, Pt][] = [
  [{ x: 0, y: 0 }, { x: COURT_W, y: 0 }],
  [{ x: COURT_W, y: 0 }, { x: COURT_W, y: COURT_L }],
  [{ x: COURT_W, y: COURT_L }, { x: 0, y: COURT_L }],
  [{ x: 0, y: COURT_L }, { x: 0, y: 0 }],
  [{ x: 0, y: NET_Y }, { x: COURT_W, y: NET_Y }],
  [{ x: 0, y: NEAR_SERVICE_Y }, { x: COURT_W, y: NEAR_SERVICE_Y }],
  [{ x: 0, y: FAR_SERVICE_Y }, { x: COURT_W, y: FAR_SERVICE_Y }],
  [{ x: COURT_W / 2, y: NEAR_SERVICE_Y }, { x: COURT_W / 2, y: FAR_SERVICE_Y }],
];
