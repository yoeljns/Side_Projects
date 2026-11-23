// Person detector: MediaPipe EfficientDet-Lite, run on crops of the frame.
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { mergeBoxes, truncatedByTile, type Tile } from './tiles';
import type { Box } from './tracker';

const WASM_PATH = '/mediapipe/wasm';
const BUCKET = 'https://storage.googleapis.com/mediapipe-models/object_detector';
const MODELS = {
  /** 448 px input: clearly better on small, far-away players; about 3× the work. */
  accurate: `${BUCKET}/efficientdet_lite2/float16/1/efficientdet_lite2.tflite`,
  fast: `${BUCKET}/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
};
export type ModelName = keyof typeof MODELS;
type Delegate = 'GPU' | 'CPU';

const TILE_MAX = 640;
const TILE_MIN = 512;
const MIN_SCORE = 0.3;
/** The accurate model is kept if a full court pass fits in this many ms. */
const ACCURATE_BUDGET_MS = 160;
/** A pass slower than this on GPU is worth comparing against CPU. */
const SLOW_MS = 150;
const APP_BINS = 11;

export class PersonDetector {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  private patch = document.createElement('canvas');
  private pctx = this.patch.getContext('2d', { willReadFrequently: true })!;
  private constructor(private det: ObjectDetector, readonly delegate: Delegate, readonly model: ModelName) {
    this.patch.width = 6;
    this.patch.height = 8;
  }

  private static async make(model: ModelName, delegate: Delegate): Promise<PersonDetector> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const det = await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODELS[model], delegate },
      runningMode: 'IMAGE',
      categoryAllowlist: ['person'],
      scoreThreshold: MIN_SCORE,
      maxResults: 8,
    });
    return new PersonDetector(det, delegate, model);
  }

  /** Milliseconds for one pass over the tiles, after a warm-up pass. */
  private bench(frame: CanvasImageSource, tiles: Tile[]): number {
    this.detect(frame, tiles); // first pass compiles shaders / allocates
    const t = performance.now();
    this.detect(frame, tiles);
    return performance.now() - t;
  }

  /**
   * Creates a warmed-up detector matched to this device: the accurate model
   * where the GPU can afford it, otherwise the fast one on whichever of GPU
   * and CPU is quicker (a "GPU" with no real hardware behind it is far slower).
   * `?model=fast|accurate` and `?delegate=cpu|gpu` override the choice.
   */
  static async create(frame: CanvasImageSource, tiles: Tile[]): Promise<PersonDetector> {
    const q = new URLSearchParams(location.search);
    const forcedDelegate = q.get('delegate')?.toUpperCase();
    const forcedModel = q.get('model');
    if (forcedModel === 'accurate' || forcedModel === 'fast') {
      const d = await PersonDetector.make(forcedModel, forcedDelegate === 'CPU' ? 'CPU' : 'GPU');
      d.bench(frame, tiles);
      return d;
    }
    let gpu: PersonDetector | null = null;
    let gpuMs = Infinity;
    if (forcedDelegate !== 'CPU') {
      try {
        const acc = await PersonDetector.make('accurate', 'GPU');
        if (acc.bench(frame, tiles) < ACCURATE_BUDGET_MS) return acc;
        acc.close();
      } catch { /* fall through to the fast model */ }
      try {
        gpu = await PersonDetector.make('fast', 'GPU');
        gpuMs = gpu.bench(frame, tiles);
        if (gpuMs < SLOW_MS || forcedDelegate === 'GPU') return gpu;
      } catch {
        gpu = null;
      }
    }
    try {
      const cpu = await PersonDetector.make('fast', 'CPU');
      if (!gpu || cpu.bench(frame, tiles) < gpuMs) {
        gpu?.close();
        return cpu;
      }
      cpu.close();
    } catch (e) {
      if (!gpu) throw e instanceof Error ? e : new Error('Could not start the player detector');
    }
    return gpu!;
  }

  /** Detect people in the given tiles of a frame. Boxes come back in frame pixels. */
  detect(frame: CanvasImageSource, tiles: Tile[]): Box[] {
    const boxes: Box[] = [];
    for (const t of tiles) {
      // Every crop is drawn onto a square canvas with its proportions kept
      // (black bars fill the rest) and small crops are enlarged. Handing the
      // model a wide, short strip to squash was measured on real footage to
      // lose most far-side players.
      const side = Math.max(t.w, t.h);
      const out = Math.round(Math.min(TILE_MAX, Math.max(TILE_MIN, side)));
      const s = out / side;
      const ox = (out - t.w * s) / 2, oy = (out - t.h * s) / 2;
      if (this.canvas.width !== out) this.canvas.width = out;
      if (this.canvas.height !== out) this.canvas.height = out;
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, out, out);
      this.ctx.imageSmoothingQuality = 'high';
      this.ctx.drawImage(frame, t.x, t.y, t.w, t.h, ox, oy, t.w * s, t.h * s);
      const res = this.det.detect(this.canvas);
      for (const d of res.detections) {
        const bb = d.boundingBox;
        if (!bb) continue;
        const b: Box = {
          x: t.x + (bb.originX - ox) / s,
          y: t.y + (bb.originY - oy) / s,
          w: bb.width / s,
          h: bb.height / s,
          score: d.categories[0]?.score ?? 0,
        };
        if (!truncatedByTile(b, t)) boxes.push(b);
      }
    }
    return mergeBoxes(boxes);
  }

  /**
   * Shirt-colour signature of a detection: a small hue histogram of the torso
   * (8 hue bins + dark / grey / light). Used to keep partners from swapping.
   */
  appearance(frame: CanvasImageSource, b: Box): Float32Array | null {
    const sw = b.w * 0.5, sh = b.h * 0.34;
    if (sw < 3 || sh < 3) return null;
    const { width: pw, height: ph } = this.patch;
    try {
      this.pctx.drawImage(frame, b.x + b.w * 0.25, b.y + b.h * 0.18, sw, sh, 0, 0, pw, ph);
      const px = this.pctx.getImageData(0, 0, pw, ph).data;
      const hist = new Float32Array(APP_BINS);
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] / 255, g = px[i + 1] / 255, bl = px[i + 2] / 255;
        const max = Math.max(r, g, bl), min = Math.min(r, g, bl), c = max - min;
        if (c < 0.12 || max < 0.15) {
          hist[max < 0.33 ? 8 : max < 0.7 ? 9 : 10]++;
        } else {
          let h = max === r ? ((g - bl) / c) % 6 : max === g ? (bl - r) / c + 2 : (r - g) / c + 4;
          if (h < 0) h += 6;
          hist[Math.min(7, Math.floor((h / 6) * 8))]++;
        }
      }
      const n = (px.length / 4) || 1;
      for (let i = 0; i < APP_BINS; i++) hist[i] /= n;
      return hist;
    } catch {
      return null;
    }
  }

  close(): void {
    this.det.close();
  }
}
