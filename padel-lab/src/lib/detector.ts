// Person detector: MediaPipe EfficientDet-Lite, run on court-following tiles.
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { mergeBoxes, truncatedByTile, type Tile } from './tiles';
import type { Box } from './tracker';

const WASM_PATH = '/mediapipe/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
const TILE_MAX = 512;
const MIN_SCORE = 0.3;
/** A pass slower than this on GPU is worth comparing against CPU. */
const SLOW_MS = 150;

export class PersonDetector {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  private constructor(private det: ObjectDetector, readonly delegate: 'GPU' | 'CPU') {}

  private static async make(delegate: 'GPU' | 'CPU'): Promise<PersonDetector> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const det = await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'IMAGE',
      categoryAllowlist: ['person'],
      scoreThreshold: MIN_SCORE,
      maxResults: 8,
    });
    return new PersonDetector(det, delegate);
  }

  /** Milliseconds for one pass over the tiles, after a warm-up pass. */
  private bench(frame: CanvasImageSource, tiles: Tile[]): number {
    this.detect(frame, tiles); // first pass compiles shaders / allocates
    const t = performance.now();
    this.detect(frame, tiles);
    return performance.now() - t;
  }

  /**
   * Creates a warmed-up detector, picking whichever of GPU and CPU is faster
   * on this device (a "GPU" without real hardware behind it is far slower).
   */
  static async create(frame: CanvasImageSource, tiles: Tile[]): Promise<PersonDetector> {
    const forced = new URLSearchParams(location.search).get('delegate')?.toUpperCase();
    let gpu: PersonDetector | null = null;
    let gpuMs = Infinity;
    if (forced !== 'CPU') {
      try {
        gpu = await PersonDetector.make('GPU');
        gpuMs = gpu.bench(frame, tiles);
        if (gpuMs < SLOW_MS || forced === 'GPU') return gpu;
      } catch {
        gpu = null;
      }
    }
    try {
      const cpu = await PersonDetector.make('CPU');
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
      const s = Math.min(1, TILE_MAX / Math.max(t.w, t.h));
      const cw = Math.max(8, Math.round(t.w * s)), ch = Math.max(8, Math.round(t.h * s));
      if (this.canvas.width !== cw) this.canvas.width = cw;
      if (this.canvas.height !== ch) this.canvas.height = ch;
      this.ctx.drawImage(frame, t.x, t.y, t.w, t.h, 0, 0, cw, ch);
      const res = this.det.detect(this.canvas);
      for (const d of res.detections) {
        const bb = d.boundingBox;
        if (!bb) continue;
        const b: Box = {
          x: t.x + bb.originX / s,
          y: t.y + bb.originY / s,
          w: bb.width / s,
          h: bb.height / s,
          score: d.categories[0]?.score ?? 0,
        };
        if (!truncatedByTile(b, t)) boxes.push(b);
      }
    }
    return mergeBoxes(boxes);
  }

  close(): void {
    this.det.close();
  }
}
