// Copies the Stockfish WASM builds out of node_modules so they can be served as
// static Web Workers. Runs before dev and build; public/engine is git-ignored.
//
//   full  stockfish-19            multi-threaded, full network (about 94 MB, strongest)
//   lite  stockfish-19-lite       multi-threaded, small network
//   lite  stockfish-19-lite-single single-threaded fallback that works everywhere
//
// Set SKIP_FULL_ENGINE=1 to leave the 94 MB build out; the app then uses lite.
import { cpSync, mkdirSync, rmSync } from 'node:fs'
const from = new URL('../node_modules/stockfish/bin/', import.meta.url)
const to = new URL('../public/engine/', import.meta.url)
rmSync(to, { recursive: true, force: true })
mkdirSync(to, { recursive: true })
const builds = ['stockfish-19-lite-single', 'stockfish-19-lite']
if (!process.env.SKIP_FULL_ENGINE) builds.push('stockfish-19')
for (const b of builds) for (const ext of ['.js', '.wasm']) cpSync(new URL(b + ext, from), new URL(b + ext, to))
