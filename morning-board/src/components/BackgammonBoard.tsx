// A full board with only the two home boards occupied (bearoff positions).
// You always sit at the bottom; your home board is bottom right, 1-point at the far right.

interface Props {
  you: readonly number[] // counts on your 1..6 points
  them: readonly number[]
  /** Cube face value and where it sits. */
  cube: { value: number; at: 'middle' | 'you' | 'them' | 'offered' }
}

const W = 520
const H = 400
const BAR = 30
const EDGE = 12
const TRAY = 44 // bear-off tray on the right
const POINT_W = (W - EDGE * 2 - BAR - TRAY) / 12
const POINT_H = 150
const R = POINT_W / 2 - 2

function pointX(i: number): number {
  // i = 0..11 from the left; the bar sits between 5 and 6
  return EDGE + i * POINT_W + (i >= 6 ? BAR : 0)
}

function Stack({ x, count, top, mine }: { x: number; count: number; top: boolean; mine: boolean }) {
  const shown = Math.min(count, 5)
  return (
    <>
      {Array.from({ length: shown }, (_, k) => {
        const cy = top ? EDGE + R + 1 + k * (R * 2) : H - EDGE - R - 1 - k * (R * 2)
        return (
          <g key={k}>
            <circle cx={x + POINT_W / 2} cy={cy} r={R} className={mine ? 'bg-checker mine' : 'bg-checker theirs'} />
            {k === shown - 1 && count > 5 && (
              <text x={x + POINT_W / 2} y={cy + 5} textAnchor="middle" className={mine ? 'bg-count mine' : 'bg-count theirs'}>{count}</text>
            )}
          </g>
        )
      })}
    </>
  )
}

export function BackgammonBoard({ you, them, cube }: Props) {
  const sum = (s: readonly number[]) => s.reduce((a, n) => a + n, 0)
  const cubeY = cube.at === 'you' ? H - EDGE - 40 : cube.at === 'them' ? EDGE + 4 : H / 2 - 18
  const cubeX = cube.at === 'offered' ? pointX(8) + POINT_W / 2 : EDGE + 6 * POINT_W + BAR / 2 - 18
  const label = (s: readonly number[]) => s.map((n, i) => (n ? `${n} on the ${i + 1}-point` : '')).filter(Boolean).join(', ')

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="bg-board"
      role="img"
      aria-label={`Backgammon bearoff. You: ${label(you)}. Opponent: ${label(them)}.`}
    >
      <rect x="0" y="0" width={W} height={H} rx="10" className="bg-frame" />
      <rect x={EDGE} y={EDGE} width={6 * POINT_W} height={H - EDGE * 2} className="bg-felt" />
      <rect x={EDGE + 6 * POINT_W + BAR} y={EDGE} width={6 * POINT_W} height={H - EDGE * 2} className="bg-felt" />
      <rect x={W - EDGE - TRAY + 8} y={EDGE} width={TRAY - 8} height={H - EDGE * 2} className="bg-felt" />
      {Array.from({ length: 12 }, (_, i) => {
        const x = pointX(i)
        const cls = i % 2 ? 'bg-point a' : 'bg-point b'
        return (
          <g key={i}>
            <polygon points={`${x},${EDGE} ${x + POINT_W},${EDGE} ${x + POINT_W / 2},${EDGE + POINT_H}`} className={cls} />
            <polygon points={`${x},${H - EDGE} ${x + POINT_W},${H - EDGE} ${x + POINT_W / 2},${H - EDGE - POINT_H}`} className={i % 2 ? 'bg-point b' : 'bg-point a'} />
          </g>
        )
      })}
      {/* point numbers for your home board */}
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <text key={n} x={pointX(12 - n) + POINT_W / 2} y={H - 1} textAnchor="middle" className="bg-num">{n}</text>
      ))}
      {you.map((n, i) => n > 0 && <Stack key={`y${i}`} x={pointX(11 - i)} count={n} top={false} mine />)}
      {them.map((n, i) => n > 0 && <Stack key={`t${i}`} x={pointX(11 - i)} count={n} top mine={false} />)}
      {/* borne-off checkers */}
      <text x={W - EDGE - (TRAY - 8) / 2} y={H - EDGE - 12} textAnchor="middle" className="bg-off">{15 - sum(you)} off</text>
      <text x={W - EDGE - (TRAY - 8) / 2} y={EDGE + 20} textAnchor="middle" className="bg-off">{15 - sum(them)} off</text>
      <g transform={`translate(${cubeX}, ${cubeY})`}>
        <rect width="36" height="36" rx="6" className="bg-cube" />
        <text x="18" y="24" textAnchor="middle" className="bg-cube-text">{cube.value}</text>
      </g>
    </svg>
  )
}
