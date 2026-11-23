// Promise wrapper around Stockfish 19 running as a WASM worker. Everything runs
// in the browser: no position ever leaves the device.

export interface Evaluation {
  /** Centipawns from the side to move's point of view (undefined when mate). */
  cp?: number
  /** Moves to mate; positive = side to move mates. */
  mate?: number
  /** Best move in UCI notation, e.g. "e2e4" or "e7e8q". */
  best: string
  /** Principal variation in UCI notation. */
  pv: string[]
}

export type EngineChoice = 'auto' | 'full' | 'lite'
type Build = 'full' | 'lite-threads' | 'lite-single'

const FILES: Record<Build, string> = {
  full: 'stockfish-19.js',
  'lite-threads': 'stockfish-19-lite.js',
  'lite-single': 'stockfish-19-lite-single.js',
}

export interface EngineInfo {
  build: Build
  threads: number
  /** Depths for the first pass over a game and for confirming a blunder. */
  scanDepth: number
  verifyDepth: number
  label: string
}

/** Threads need a cross-origin isolated page (see vercel.json); the full network needs a real computer. */
export function chooseBuild(choice: EngineChoice): Build {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  if (!isolated) return 'lite-single'
  if (choice === 'lite') return 'lite-threads'
  if (choice === 'full') return 'full'
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8
  const phone = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  return !phone && memory >= 8 && navigator.hardwareConcurrency >= 4 ? 'full' : 'lite-threads'
}

function describe(build: Build): EngineInfo {
  const threads = build === 'lite-single' ? 1 : Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1))
  const full = build === 'full'
  return {
    build,
    threads,
    scanDepth: full ? 14 : 12,
    verifyDepth: full ? 20 : build === 'lite-threads' ? 18 : 16,
    label: `Stockfish 19${full ? '' : ' lite'}, ${threads} thread${threads === 1 ? '' : 's'}`,
  }
}

export class Engine {
  private worker!: Worker
  private listeners: ((line: string) => void)[] = []
  private queue: Promise<unknown> = Promise.resolve()
  info: EngineInfo
  readonly ready: Promise<void>

  constructor(choice: EngineChoice = 'auto') {
    this.info = describe(chooseBuild(choice))
    // If the big build cannot start (missing file, out of memory), fall back rather than fail.
    this.ready = this.start(this.info.build).catch((e) => {
      if (this.info.build === 'lite-single') throw e
      this.worker.terminate()
      this.info = describe('lite-single')
      return this.start('lite-single')
    })
  }

  private start(build: Build): Promise<void> {
    this.listeners = []
    this.worker = new Worker(`${import.meta.env.BASE_URL}engine/${FILES[build]}`)
    this.worker.onmessage = (e: MessageEvent) => {
      const line = String(e.data)
      for (const l of [...this.listeners]) l(line)
    }
    return new Promise<void>((resolve, reject) => {
      // The 94 MB network can take a while on a slow line; anything slower than this is treated as broken.
      const timer = setTimeout(() => reject(new Error('Stockfish took too long to load')), build === 'full' ? 180000 : 60000)
      this.worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || 'Stockfish failed to load')) }
      void this.waitFor((l) => l === 'uciok').then(() => {
        const { threads } = describe(build)
        if (threads > 1) this.worker.postMessage(`setoption name Threads value ${threads}`)
        this.worker.postMessage(`setoption name Hash value ${build === 'full' ? 128 : 32}`)
        this.worker.postMessage('isready')
        return this.waitFor((l) => l === 'readyok')
      }).then(() => { clearTimeout(timer); resolve() })
      this.worker.postMessage('uci')
    })
  }

  private waitFor(match: (line: string) => boolean, onLine?: (line: string) => void): Promise<string> {
    return new Promise((resolve) => {
      const listener = (line: string) => {
        onLine?.(line)
        if (match(line)) {
          this.listeners = this.listeners.filter((l) => l !== listener)
          resolve(line)
        }
      }
      this.listeners.push(listener)
    })
  }

  /** Evaluate a position. The position must not be checkmate or stalemate. */
  evaluate(fen: string, depth: number): Promise<Evaluation> {
    const run = async (): Promise<Evaluation> => {
      await this.ready
      let cp: number | undefined
      let mate: number | undefined
      let pv: string[] = []
      const done = this.waitFor(
        (l) => l.startsWith('bestmove'),
        (l) => {
          const m = /^info .*?score (cp|mate) (-?\d+)(?: (lowerbound|upperbound))?.* pv (.+)$/.exec(l)
          if (!m || m[3]) return
          if (m[1] === 'cp') { cp = Number(m[2]); mate = undefined } else { mate = Number(m[2]); cp = undefined }
          pv = m[4].trim().split(' ')
        },
      )
      this.worker.postMessage(`position fen ${fen}`)
      this.worker.postMessage(`go depth ${depth}`)
      const line = await done
      const best = line.split(' ')[1]
      return { cp, mate, best, pv: pv.length ? pv : [best] }
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }

  dispose() {
    this.worker.terminate()
  }
}

let shared: { choice: EngineChoice; engine: Engine } | undefined

/** One engine for the whole page, started on first use and replaced if the setting changes. */
export function getEngine(choice: EngineChoice = shared?.choice ?? 'auto'): Engine {
  if (shared && shared.choice !== choice) {
    shared.engine.dispose()
    shared = undefined
  }
  shared ??= { choice, engine: new Engine(choice) }
  return shared.engine
}
