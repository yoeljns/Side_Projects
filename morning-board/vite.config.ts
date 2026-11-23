import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Multi-threaded Stockfish needs SharedArrayBuffer, which browsers only allow on
// cross-origin isolated pages. vercel.json sets the same headers in production.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
})
