// Captures the video's soundtrack while it plays and builds a loudness envelope
// in media time. Working from playback (rather than decoding the file) keeps
// memory flat, so a 90-minute match costs the same as a 5-minute clip.
import { ENV_BIN } from './hits';

type SyncPoint = { c: number; m: number };
type Batch = { t: number; hop: number; v: Float32Array };

/** Maps audio-clock hops onto media-time bins. Pure, so it can be tested. */
export class EnvelopeBuilder {
  private sync: SyncPoint[] = [];
  private pending: Batch[] = [];
  private bins: Float32Array;
  private filled: Uint8Array;
  private si = 0;

  constructor(duration: number) {
    const n = Math.max(1, Math.ceil(duration / ENV_BIN) + 1);
    this.bins = new Float32Array(n);
    this.filled = new Uint8Array(n);
  }

  /** Record that audio-clock time `c` corresponds to media time `m`. */
  addSync(c: number, m: number): void {
    const last = this.sync[this.sync.length - 1];
    if (last && c <= last.c) return;
    this.sync.push({ c, m });
    this.flush();
  }

  addBatch(b: Batch): void {
    this.pending.push(b);
    this.flush();
  }

  private flush(): void {
    const s = this.sync;
    if (s.length < 2) return;
    const lastC = s[s.length - 1].c;
    while (this.pending.length) {
      const b = this.pending[0];
      if (b.t + b.hop * b.v.length > lastC) break; // wait for a sync point past this batch
      this.pending.shift();
      for (let i = 0; i < b.v.length; i++) {
        const c = b.t + b.hop * (i + 0.5);
        if (c < s[0].c) continue;
        while (this.si < s.length - 2 && s[this.si + 1].c < c) this.si++;
        const a = s[this.si], z = s[this.si + 1];
        if (z.m <= a.m) continue; // paused or seeking: nothing new was heard
        const m = a.m + ((c - a.c) / (z.c - a.c)) * (z.m - a.m);
        const k = Math.floor(m / ENV_BIN);
        if (k < 0 || k >= this.bins.length) continue;
        if (b.v[i] > this.bins[k]) this.bins[k] = b.v[i];
        this.filled[k] = 1;
      }
    }
  }

  /** Envelope up to media time `upTo`. Bins that got no hop inherit their neighbour. */
  finish(upTo: number): Float32Array {
    const n = Math.min(this.bins.length, Math.max(0, Math.ceil(upTo / ENV_BIN)));
    const out = this.bins.slice(0, n);
    for (let i = 1; i < n; i++) if (!this.filled[i]) out[i] = out[i - 1];
    return out;
  }
}

export type AudioTap = {
  ctx: AudioContext;
  out: GainNode;
  onBatch: ((b: Batch) => void) | null;
};

const taps = new WeakMap<HTMLVideoElement, AudioTap>();

/**
 * Route the video's audio through a worklet (and on to a muted output).
 * Returns null where the browser can't do it; analysis then runs without rallies.
 */
export async function attachAudio(video: HTMLVideoElement): Promise<AudioTap | null> {
  const existing = taps.get(video);
  if (existing) {
    await existing.ctx.resume().catch(() => {});
    return existing;
  }
  try {
    const ctx = new AudioContext({ latencyHint: 'playback' });
    await ctx.audioWorklet.addModule('/hit-envelope.worklet.js');
    const src = ctx.createMediaElementSource(video);
    const node = new AudioWorkletNode(ctx, 'hit-envelope', { numberOfOutputs: 1 });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node).connect(mute).connect(ctx.destination);
    const tap: AudioTap = { ctx, out: mute, onBatch: null };
    node.port.onmessage = (e) => tap.onBatch?.(e.data as Batch);
    await ctx.resume().catch(() => {});
    taps.set(video, tap);
    return tap;
  } catch (e) {
    console.warn('Audio capture unavailable; rallies will not be detected.', e);
    return null;
  }
}

/** Silence the speakers during analysis; restore them for watching back. */
export function setAudible(video: HTMLVideoElement, on: boolean): void {
  const tap = taps.get(video);
  if (tap) tap.out.gain.value = on ? 1 : 0;
}
