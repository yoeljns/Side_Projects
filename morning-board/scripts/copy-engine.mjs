// Copies the Stockfish WASM build out of node_modules so it can be served as a
// static Web Worker. Runs before dev and build; public/engine is git-ignored.
import { cpSync, mkdirSync } from 'node:fs'
const from = new URL('../node_modules/stockfish/bin/', import.meta.url)
const to = new URL('../public/engine/', import.meta.url)
mkdirSync(to, { recursive: true })
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) cpSync(new URL(f, from), new URL(f, to))
