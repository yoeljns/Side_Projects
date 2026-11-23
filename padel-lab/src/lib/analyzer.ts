// Plays the video (faster than real time where the device keeps up), samples
// frames for player positions and listens to the soundtrack for hits.
import type { Pt } from './court';
import { attachAudio, EnvelopeBuilder, type AudioTap } from './audio';
import { PersonDetector } from './detector';
import { homography, type H } from './homography';
import { Sampler } from './sampler';
import { buildTiles, type Tile } from './tiles';
import type { Assignment, Sample } from './tracker';
import { setAudible } from './audio';

/** Seconds of media time between position samples. */
const SAMPLE_DT = 0.2;
const START_RATE = 4;
/** A device that can't keep up even at normal speed gets slow motion rather than gaps. */
const MIN_RATE = 0.25;

export type Calibration = {
  /** Four tapped points, normalised to 0..1 of the video frame. */
  image: Pt[];
  /** The court positions (metres) those points correspond to. */
  court: Pt[];
};

export type AnalysisResult = {
  samples: Sample[][];
  /** Loudness envelope, or null when audio could not be captured. */
  envelope: Float32Array | null;
  /** Seconds of video covered. */
  analysedSec: number;
  frames: number;
  /** A small snapshot of each player, to pick yourself out. */
  thumbs: (string | null)[];
};

export type Progress = {
  t: number;
  duration: number;
  rate: number;
  frames: number;
  assignments: Assignment[];
  audio: boolean;
  /** Which detector ended up running, e.g. "accurate · GPU". */
  engine: string;
};

export function calibrationMatrices(c: Calibration, W: number, Hh: number): { toCourt: H; toImage: H } | null {
  const px = c.image.map((p) => ({ x: p.x * W, y: p.y * Hh }));
  const toCourt = homography(px, c.court);
  const toImage = homography(c.court, px);
  return toCourt && toImage ? { toCourt, toImage } : null;
}

export class Analyzer {
  private sampler: Sampler | null = null;
  private detector: PersonDetector | null = null;
  private tap: AudioTap | null = null;
  private env: EnvelopeBuilder | null = null;
  private tiles: Tile[] = [];
  private toCourt!: H;
  private running = false;
  private lastT = -Infinity;
  private maxT = 0;
  private gaps: number[] = [];
  private thumbs: (string | null)[] = [null, null, null, null];
  private thumbScore = [0, 0, 0, 0];
  private thumbCanvas = document.createElement('canvas');
  private syncTimer = 0;
  private wakeLock: { release(): Promise<void> } | null = null;
  private done!: (r: AnalysisResult) => void;
  private finished = false;
  readonly result: Promise<AnalysisResult>;

  constructor(
    private video: HTMLVideoElement,
    private calibration: Calibration,
    private onProgress: (p: Progress) => void,
  ) {
    this.result = new Promise((res) => (this.done = res));
  }

  /** Loads the detector and starts playback. Must be called from a user gesture. */
  async start(): Promise<void> {
    const v = this.video;
    const m = calibrationMatrices(this.calibration, v.videoWidth, v.videoHeight);
    if (!m) throw new Error('The four calibration points do not describe a court. Re-do the calibration.');
    this.toCourt = m.toCourt;
    this.tiles = buildTiles(m.toImage, v.videoWidth, v.videoHeight);

    // Audio first: it has to be set up inside the user gesture.
    this.tap = await attachAudio(v);
    setAudible(v, false);

    if (this.tap) {
      this.env = new EnvelopeBuilder(v.duration);
      this.tap.onBatch = (b) => this.env?.addBatch(b);
      this.syncTimer = window.setInterval(() => this.addSync(), 30);
      v.muted = false;
      v.volume = 1;
    } else {
      v.muted = true;
    }
    v.preservesPitch = false;
    v.loop = false;
    v.pause();
    v.currentTime = 0;
    await new Promise<void>((res) => {
      if (v.currentTime === 0 && !v.seeking) return res();
      v.addEventListener('seeked', () => res(), { once: true });
    });
    // Loading includes a warm-up pass (the first inference can take seconds),
    // done here so no footage slips past once the video is moving.
    this.detector = await PersonDetector.create(v, this.tiles);
    this.sampler = new Sampler(this.detector, this.toCourt, m.toImage, this.tiles, v.videoWidth, v.videoHeight);
    v.playbackRate = START_RATE;
    v.addEventListener('ended', this.finish);
    document.addEventListener('visibilitychange', this.onVisibility);
    try {
      this.wakeLock = (await (navigator as any).wakeLock?.request('screen')) ?? null;
    } catch { /* not essential */ }
    this.running = true;
    await v.play();
    v.requestVideoFrameCallback(this.onFrame);
  }

  /** Stop early and keep what has been analysed so far. */
  stop(): void {
    this.finish();
  }

  private addSync(): void {
    if (this.tap && this.env && !this.video.paused) this.env.addSync(this.tap.ctx.currentTime, this.video.currentTime);
  }

  private onVisibility = (): void => {
    if (!this.running) return;
    // Frame callbacks stop in a hidden tab, so hold the video until we're back.
    if (document.hidden) this.video.pause();
    else void this.video.play();
  };

  private onFrame = (_now: number, meta: VideoFrameCallbackMetadata): void => {
    if (!this.running) return;
    const t = meta.mediaTime;
    if (t - this.lastT >= SAMPLE_DT) this.sample(t);
    this.video.requestVideoFrameCallback(this.onFrame);
  };

  private sample(t: number): void {
    const v = this.video;
    if (isFinite(this.lastT)) this.adaptRate(t - this.lastT);
    this.lastT = t;
    this.maxT = Math.max(this.maxT, t);

    const det = this.detector!;
    const assignments = this.sampler!.step(v, t);
    for (const a of assignments) this.maybeThumb(a);
    this.onProgress({
      t,
      duration: v.duration,
      rate: v.playbackRate,
      frames: this.sampler?.frames ?? 0,
      assignments,
      audio: !!this.env,
      engine: `${det.model} · ${det.delegate}`,
    });
  }

  /** Slow playback down when detection can't keep up with it. */
  private adaptRate(gap: number): void {
    const v = this.video;
    this.gaps.push(gap);
    const n = this.gaps.length;
    // Two slow samples in a row, or a slow median over eight: halve the speed.
    const twoSlow = n >= 2 && this.gaps[n - 1] > SAMPLE_DT * 3 && this.gaps[n - 2] > SAMPLE_DT * 3;
    if (!twoSlow && n < 8) return;
    const median = this.gaps.slice().sort((a, b) => a - b)[n >> 1];
    this.gaps = [];
    if ((twoSlow || median > SAMPLE_DT * 1.8) && v.playbackRate > MIN_RATE) v.playbackRate = Math.max(MIN_RATE, v.playbackRate / 2);
  }

  private maybeThumb({ slot, det }: Assignment): void {
    const { box } = det;
    if (box.score < this.thumbScore[slot] + 0.08 || box.h < 24) return;
    this.thumbScore[slot] = box.score;
    const c = this.thumbCanvas;
    c.width = 72;
    c.height = 120;
    const pad = box.h * 0.08;
    const h = box.h + pad * 2, w = h * (c.width / c.height);
    const cx = box.x + box.w / 2;
    c.getContext('2d')!.drawImage(this.video, cx - w / 2, box.y - pad, w, h, 0, 0, c.width, c.height);
    try {
      this.thumbs[slot] = c.toDataURL('image/jpeg', 0.75);
    } catch { /* tainted canvas can't happen for local files */ }
  }

  private finish = (): void => {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    const v = this.video;
    this.addSync();
    window.clearInterval(this.syncTimer);
    v.removeEventListener('ended', this.finish);
    document.removeEventListener('visibilitychange', this.onVisibility);
    const analysedSec = v.ended ? v.duration : Math.max(this.maxT, v.currentTime);
    v.pause();
    v.playbackRate = 1;
    if (this.tap) this.tap.onBatch = null;
    setAudible(v, true); // so the match can be watched back with sound
    void this.wakeLock?.release().catch(() => {});
    this.detector?.close();
    this.done({
      samples: this.sampler?.tracker.samples ?? [[], [], [], []],
      envelope: this.env ? this.env.finish(analysedSec) : null,
      analysedSec,
      frames: this.sampler?.frames ?? 0,
      thumbs: this.thumbs,
    });
  };
}
