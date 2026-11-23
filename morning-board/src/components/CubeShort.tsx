// "Double or no double?" as a vertical Short: the position, a countdown to
// think, then the answer. Drawn on a 1080x1920 canvas (text on screen only, no
// audio) so it can be recorded straight to a video file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { choiceEquity, correctChoice, type CubePosition } from '../lib/cube.ts'
import { pipCount } from '../lib/raceCount.ts'
import { tavlaValue } from '../lib/tavla.ts'
import './cube-extras.css'

const W = 1080
const H = 1920
const T_BOARD = 0.5 // board fades in
const T_THINK = 2.4 // countdown starts
const THINK = 5 // seconds to think
const T_REVEAL = T_THINK + THINK
const T_END = T_REVEAL + 6.5 // closing card
const SHORT_SECONDS = T_END + 2.2

interface Palette {
  bg: string; surface: string; ink: string; muted: string; accent: string; accentInk: string; good: string
  felt: string; frame: string; pointA: string; pointB: string; mine: string; theirs: string; mineEdge: string; theirsEdge: string
}
// Mirrors the tokens in index.css so the video looks like the app.
const LIGHT: Palette = {
  bg: '#f6f1e7', surface: '#fffdf8', ink: '#23201b', muted: '#6f675b', accent: '#c2571a', accentInk: '#ffffff', good: '#2f7d4f',
  felt: '#dfd3bb', frame: '#6b4a2f', pointA: '#a9805a', pointB: '#f6ecd8', mine: '#fbf6ea', theirs: '#2b2622', mineEdge: '#8c7a5c', theirsEdge: '#6d665d',
}
const DARK: Palette = {
  bg: '#15171c', surface: '#1d2027', ink: '#ece7dd', muted: '#9c978c', accent: '#e8813f', accentInk: '#1a1206', good: '#5fbf85',
  felt: '#2a2e37', frame: '#0f1115', pointA: '#8a6748', pointB: '#4a505c', mine: '#ece3cf', theirs: '#111317', mineEdge: '#8c7a5c', theirsEdge: '#6d665d',
}

const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const eq = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`
const pct = (x: number) => `${Math.round(x * 100)}%`
const clamp = (x: number) => Math.max(0, Math.min(1, x))
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3)

interface Model {
  you: number[]; them: number[]
  cube: { value: number; at: 'middle' | 'you' | 'offered' }
  hook: string; setup: string; pips: string
  answer: string; answerNote: string
  rows: { label: string; value: string; best: boolean }[]
  chances: string; tavla: string; source: string
}

function buildModel(p: CubePosition): Model {
  const asking = p.kind === 'double'
  const held = p.cube === 'roller'
  const you = asking ? p.roller : p.opponent
  const them = asking ? p.opponent : p.roller
  const correct = correctChoice(p)
  const yourWin = asking ? p.win : 1 - p.win
  const yourGammon = (asking ? p.gammon : p.loseGammon) ?? 0
  const theirGammon = (asking ? p.loseGammon : p.gammon) ?? 0
  const answers: Record<string, [string, string]> = {
    'no-double': [held ? 'NO REDOUBLE' : 'NO DOUBLE', 'Not good enough yet: roll on.'],
    'double-take': [held ? 'REDOUBLE · TAKE' : 'DOUBLE · TAKE', 'Strong enough to double, and they can still take.'],
    'double-pass': [held ? 'REDOUBLE · PASS' : 'DOUBLE · PASS', 'They should give up the game.'],
    'too-good': ['TOO GOOD', 'Do not double: play on for the gammon.'],
    take: ['TAKE', 'Still enough play to accept the cube.'],
    pass: ['PASS', 'Give up one point rather than play for two.'],
  }
  const rows = asking
    ? [
        { label: 'Roll on', value: eq(p.noDouble), best: correct === 'no-double' || correct === 'too-good' },
        { label: held ? 'Redouble' : 'Double', value: eq(choiceEquity(p, 'double-take')), best: correct === 'double-take' || correct === 'double-pass' },
      ]
    : [
        { label: 'Take', value: eq(-p.doubleTake), best: correct === 'take' },
        { label: 'Pass', value: eq(-1), best: correct === 'pass' },
      ]
  const t = tavlaValue(yourWin, yourGammon, theirGammon)
  return {
    you, them,
    cube: asking ? { value: held ? 2 : 64, at: held ? 'you' : 'middle' } : { value: held ? 4 : 2, at: 'offered' },
    hook: asking ? (held ? 'Redouble or not?' : 'Double or no double?') : 'Take or pass?',
    setup: asking
      ? held ? 'You own the cube on 2 and it is your roll.' : 'Your roll. The cube is in the middle.'
      : `Your opponent ${held ? 'redoubles to 4' : 'doubles to 2'}.`,
    pips: `You ${pipCount(you)} pips  ·  Them ${pipCount(them)}`,
    answer: answers[correct][0],
    answerNote: answers[correct][1],
    rows,
    chances: p.source === 'exact' || yourGammon + theirGammon < 0.005
      ? `You win ${pct(yourWin)} of the time`
      : `You win ${pct(yourWin)}  ·  gammons ${pct(yourGammon)} for, ${pct(theirGammon)} against`,
    tavla: `Tavla, no cube: worth ${t.points >= 0 ? '+' : '−'}${Math.abs(t.points).toFixed(2)} a game`,
    source: p.source === 'exact' ? 'Exact bearoff solution · money game' : 'GNU Backgammon, 2-ply · money game',
  }
}

// --- board, same geometry as BackgammonBoard.tsx (520 x 400 units) ---
const BW = 520, BH = 400, BAR = 30, EDGE = 12, TRAY = 44
const POINT_W = (BW - EDGE * 2 - BAR - TRAY) / 12
const POINT_H = 150
const R = POINT_W / 2 - 2
const colX = (i: number) => EDGE + i * POINT_W + (i >= 6 ? BAR : 0)
const place = (point: number) => (point <= 12 ? { col: 12 - point, top: false } : { col: point - 13, top: true })

function drawBoard(c: CanvasRenderingContext2D, m: Model, pal: Palette, x: number, y: number, width: number) {
  const s = width / BW
  c.save()
  c.translate(x, y)
  c.scale(s, s)
  c.fillStyle = pal.frame
  c.beginPath(); c.roundRect(0, 0, BW, BH, 10); c.fill()
  c.fillStyle = pal.felt
  c.fillRect(EDGE, EDGE, 6 * POINT_W, BH - EDGE * 2)
  c.fillRect(EDGE + 6 * POINT_W + BAR, EDGE, 6 * POINT_W, BH - EDGE * 2)
  c.fillRect(BW - EDGE - TRAY + 8, EDGE, TRAY - 8, BH - EDGE * 2)
  for (let i = 0; i < 12; i++) {
    const px = colX(i)
    const tri = (baseY: number, tipY: number, fill: string) => {
      c.fillStyle = fill
      c.beginPath(); c.moveTo(px, baseY); c.lineTo(px + POINT_W, baseY); c.lineTo(px + POINT_W / 2, tipY); c.closePath(); c.fill()
    }
    tri(EDGE, EDGE + POINT_H, i % 2 ? pal.pointA : pal.pointB)
    tri(BH - EDGE, BH - EDGE - POINT_H, i % 2 ? pal.pointB : pal.pointA)
  }
  const checker = (cx: number, cy: number, mine: boolean, label?: number) => {
    c.fillStyle = mine ? pal.mine : pal.theirs
    c.strokeStyle = mine ? pal.mineEdge : pal.theirsEdge
    c.lineWidth = 1.5
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill(); c.stroke()
    if (label) {
      c.fillStyle = mine ? '#23201b' : '#f1eadc'
      c.font = `700 14px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.fillText(String(label), cx, cy + 1)
    }
  }
  const stack = (cx: number, count: number, top: boolean, mine: boolean, fromY?: number) => {
    const shown = Math.min(count, 5)
    for (let k = 0; k < shown; k++) {
      const cy = fromY !== undefined ? fromY + (top ? -1 : 1) * k * R * 2 : top ? EDGE + R + 1 + k * R * 2 : BH - EDGE - R - 1 - k * R * 2
      checker(cx, cy, mine, k === shown - 1 && count > 5 ? count : undefined)
    }
  }
  for (let i = 0; i < 24; i++) {
    const { col, top } = place(i + 1)
    const cx = colX(col) + POINT_W / 2
    if (m.you[i] > 0) stack(cx, m.you[i], top, true)
    if (m.them[23 - i] > 0) stack(cx, m.them[23 - i], top, false)
  }
  const barX = EDGE + 6 * POINT_W + BAR / 2
  if ((m.you[24] ?? 0) > 0) stack(barX, m.you[24], true, true, BH / 2 - R - 26)
  if ((m.them[24] ?? 0) > 0) stack(barX, m.them[24], false, false, BH / 2 + R + 26)
  // cube
  const cubeY = m.cube.at === 'you' ? BH - EDGE - 40 : BH / 2 - 18
  const cubeX = m.cube.at === 'offered' ? colX(8) + POINT_W / 2 : m.cube.at === 'middle' ? barX - 18 : BW - EDGE - (TRAY - 8) / 2 - 18
  c.fillStyle = '#fbf6ea'; c.strokeStyle = '#8c7a5c'; c.lineWidth = 1
  c.beginPath(); c.roundRect(cubeX, cubeY, 36, 36, 6); c.fill(); c.stroke()
  c.fillStyle = '#23201b'; c.font = `700 17px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(String(m.cube.value), cubeX + 18, cubeY + 19)
  c.restore()
}

function wrap(c: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && c.measureText(next).width > maxWidth) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** Draw the frame at time t (seconds). */
function drawShort(c: CanvasRenderingContext2D, m: Model, pal: Palette, t: number) {
  c.globalAlpha = 1
  c.fillStyle = pal.bg
  c.fillRect(0, 0, W, H)
  const text = (s: string, x: number, y: number, font: string, fill: string, align: CanvasTextAlign = 'center') => {
    c.font = font; c.fillStyle = fill; c.textAlign = align; c.textBaseline = 'alphabetic'
    c.fillText(s, x, y)
  }

  const closing = clamp((t - T_END) / 0.5)
  if (closing < 1) {
    c.globalAlpha = 1 - closing
    // hook
    const hookIn = ease(t / 0.5)
    c.globalAlpha = (1 - closing) * hookIn
    text('BACKGAMMON', W / 2, 150 - (1 - hookIn) * 30, `700 34px ${SANS}`, pal.accent)
    c.font = `600 104px ${SERIF}`
    const hookLines = wrap(c, m.hook, 960)
    hookLines.forEach((l, i) => text(l, W / 2, 270 + i * 112 - (1 - hookIn) * 30, `600 104px ${SERIF}`, pal.ink))
    const afterHook = 270 + (hookLines.length - 1) * 112
    c.globalAlpha = (1 - closing) * ease((t - 0.3) / 0.5)
    text(m.setup, W / 2, afterHook + 80, `400 44px ${SANS}`, pal.muted)

    // board
    const boardIn = ease((t - T_BOARD) / 0.6)
    c.globalAlpha = (1 - closing) * boardIn
    const by = 520 + (1 - boardIn) * 40
    drawBoard(c, m, pal, 40, by, 1000)
    text(m.pips, W / 2, by + 769 + 70, `600 42px ${SANS}`, pal.ink)
    text('You are the light checkers, bearing off bottom right', W / 2, by + 769 + 122, `400 30px ${SANS}`, pal.muted)

    if (t < T_REVEAL) {
      // countdown ring
      const k = clamp((t - T_THINK) / THINK)
      const ringIn = ease((t - T_THINK + 0.4) / 0.4)
      c.globalAlpha = (1 - closing) * ringIn
      const cx = W / 2, cy = 1640, r = 120
      c.lineWidth = 18; c.lineCap = 'round'
      c.strokeStyle = pal.felt
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke()
      c.strokeStyle = pal.accent
      c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - k)); c.stroke()
      const left = t < T_THINK ? THINK : Math.max(1, Math.ceil(THINK - (t - T_THINK)))
      c.textBaseline = 'middle'
      c.font = `700 120px ${SANS}`; c.fillStyle = pal.ink; c.textAlign = 'center'
      c.fillText(String(left), cx, cy + 6)
      text('What would you do?', W / 2, 1840, `500 40px ${SANS}`, pal.muted)
    } else {
      // reveal panel
      const a = ease((t - T_REVEAL) / 0.5)
      c.globalAlpha = (1 - closing) * a
      const top = 1452 + (1 - a) * 40
      c.fillStyle = pal.surface
      c.beginPath(); c.roundRect(40, top, 1000, 428, 28); c.fill()
      c.fillStyle = pal.good
      c.beginPath(); c.roundRect(40, top, 1000, 132, [28, 28, 0, 0]); c.fill()
      c.textBaseline = 'middle'
      c.font = `800 76px ${SANS}`; c.fillStyle = '#ffffff'; c.textAlign = 'center'
      c.fillText(m.answer, W / 2, top + 70)
      text(m.answerNote, W / 2, top + 186, `500 36px ${SANS}`, pal.ink)
      m.rows.forEach((row, i) => {
        const rowIn = ease((t - T_REVEAL - 0.5 - i * 0.25) / 0.4)
        c.globalAlpha = (1 - closing) * a * rowIn
        const x = 90 + i * 470
        text(row.label, x, top + 250, `500 34px ${SANS}`, pal.muted, 'left')
        text(row.value, x + 420, top + 250, `700 40px ${SANS}`, row.best ? pal.good : pal.ink, 'right')
      })
      c.globalAlpha = (1 - closing) * a * ease((t - T_REVEAL - 1.2) / 0.5)
      text(m.chances, W / 2, top + 318, `500 34px ${SANS}`, pal.ink)
      c.globalAlpha = (1 - closing) * a * ease((t - T_REVEAL - 2) / 0.5)
      text(m.tavla, W / 2, top + 368, `500 32px ${SANS}`, pal.accent)
      text(m.source, W / 2, top + 408, `400 24px ${SANS}`, pal.muted)
    }
  }
  if (closing > 0) {
    c.globalAlpha = closing
    text('BACKGAMMON', W / 2, 760, `700 34px ${SANS}`, pal.accent)
    text('Did you get it?', W / 2, 900, `600 110px ${SERIF}`, pal.ink)
    c.fillStyle = pal.good
    c.beginPath(); c.roundRect(190, 980, 700, 130, 24); c.fill()
    c.textBaseline = 'middle'
    c.font = `800 64px ${SANS}`; c.fillStyle = '#ffffff'; c.textAlign = 'center'
    c.fillText(m.answer, W / 2, 1048)
    text('A cube decision every day', W / 2, 1220, `400 44px ${SANS}`, pal.muted)
  }
  c.globalAlpha = 1
  // progress bar
  c.fillStyle = pal.accent
  c.fillRect(0, H - 10, W * clamp(t / SHORT_SECONDS), 10)
}

const FORMATS = [
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
]
const canRecord = typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype
const format = canRecord ? FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) : undefined

export function CubeShort({ position, onClose }: { position: CubePosition; onClose: () => void }) {
  const model = useMemo(() => buildModel(position), [position])
  const [dark] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches)
  const pal = dark ? DARK : LIGHT
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const time = useRef(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const [playing, setPlaying] = useState(true)
  const [recording, setRecording] = useState(false)
  const [shown, setShown] = useState(0) // time shown on the scrubber

  const paint = useCallback(() => {
    const c = canvasRef.current?.getContext('2d')
    if (c) drawShort(c, model, pal, time.current)
  }, [model, pal])

  const finish = useCallback(() => {
    setPlaying(false)
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }, [])

  useEffect(() => {
    paint()
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      time.current = Math.min(SHORT_SECONDS, time.current + (now - last) / 1000)
      last = now
      paint()
      setShown(time.current)
      if (time.current >= SHORT_SECONDS) finish()
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, paint, finish])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Leaving mid-recording ends the recording rather than leaking the stream.
  useEffect(() => () => {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }, [])

  function seek(t: number) {
    time.current = t
    setShown(t)
    paint()
  }

  function restart() {
    seek(0)
    setPlaying(true)
  }

  function record() {
    const canvas = canvasRef.current
    if (!canvas || !format) return
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: format.mime, videoBitsPerSecond: 8_000_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => {
      rec.stream.getTracks().forEach((track) => track.stop())
      recorder.current = null
      setRecording(false)
      if (!chunks.length) return
      const url = URL.createObjectURL(new Blob(chunks, { type: format.mime.split(';')[0] }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${model.hook.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}.${format.ext}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    }
    recorder.current = rec
    setRecording(true)
    seek(0)
    rec.start()
    setPlaying(true)
  }

  return (
    <div className="short-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="short-panel" role="dialog" aria-modal="true" aria-label="Short video of this position">
        <canvas ref={canvasRef} width={W} height={H} className="short-canvas" data-testid="short-canvas" />
        <div className="short-side">
          <h3>Short: {model.hook}</h3>
          <p className="muted">
            {Math.round(SHORT_SECONDS)} seconds, 1080 × 1920, text on screen only. The answer appears after a {THINK}-second countdown.
          </p>
          <input
            type="range" min={0} max={SHORT_SECONDS} step={0.05} value={shown} disabled={recording}
            aria-label="Position in the video"
            onChange={(e) => { setPlaying(false); seek(Number(e.target.value)) }}
          />
          <div className="short-buttons">
            <button type="button" className="ghost" disabled={recording} onClick={() => (shown >= SHORT_SECONDS ? restart() : setPlaying((p) => !p))}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="ghost" disabled={recording} onClick={restart}>Restart</button>
            {format && (
              <button type="button" className="primary" disabled={recording} onClick={record} data-testid="short-record">
                {recording ? 'Recording…' : 'Record'}
              </button>
            )}
            <button type="button" className="ghost" onClick={onClose}>Close</button>
          </div>
          <p className="muted small">
            {!format
              ? 'This browser cannot record the canvas. Use a screen recorder, or open this in a current Chrome, Edge or Safari.'
              : format.ext === 'mp4'
                ? 'Record plays it once in real time and downloads an MP4 (H.264), which YouTube, Instagram and TikTok accept.'
                : 'Record plays it once in real time and downloads a WebM: this browser cannot record MP4. YouTube takes WebM; Instagram and TikTok need MP4, so record in a current Chrome, Edge or Safari, or convert the file.'}
          </p>
        </div>
      </div>
    </div>
  )
}
