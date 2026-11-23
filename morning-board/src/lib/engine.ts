// Thin promise wrapper around the Stockfish WASM worker. Everything runs in
// the browser: no position ever leaves the device.

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

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`

export class Engine {
  private worker: Worker
  private listeners: ((line: string) => void)[] = []
  private queue: Promise<unknown> = Promise.resolve()
  readonly ready: Promise<void>

  constructor() {
    this.worker = new Worker(ENGINE_URL)
    this.worker.onmessage = (e: MessageEvent) => {
      const line = String(e.data)
      for (const l of [...this.listeners]) l(line)
    }
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker.onerror = (e) => reject(new Error(e.message || 'Stockfish failed to load'))
      this.waitFor((l) => l === 'uciok').then(() => {
        this.worker.postMessage('isready')
        return this.waitFor((l) => l === 'readyok')
      }).then(() => resolve())
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

let shared: Engine | undefined

/** One engine for the whole page, started on first use. */
export const getEngine = (): Engine => (shared ??= new Engine())
