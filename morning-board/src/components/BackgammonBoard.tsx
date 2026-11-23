// You always sit at the bottom and bear off to the bottom right: your 1-point is
// the far right of the bottom row, your 24-point the far right of the top row.

interface Props {
  /** Checkers on your points 1..24, then your bar (index 24). */
  you: readonly number[]
  /** The opponent's checkers, counted from their own home (their point k is your point 25-k). */
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

/** Left edge of a column, 0..11 from the left; the bar sits between 5 and 6. */
const colX = (i: number) => EDGE + i * POINT_W + (i >= 6 ? BAR : 0)
/** Where one of your points (1..24) is drawn. */
const place = (point: number) => (point <= 12 ? { col: 12 - point, top: false } : { col: point - 13, top: true })

function Stack({ cx, count, top, mine, fromY }: { cx: number; count: number; top: boolean; mine: boolean; fromY?: number }) {
  const shown = Math.min(count, 5)
  return (
    <>
      {Array.from({ length: shown }, (_, k) => {
        const cy = fromY !== undefined ? fromY + (top ? -1 : 1) * k * (R * 2) : top ? EDGE + R + 1 + k * (R * 2) : H - EDGE - R - 1 - k * (R * 2)
        return (
          <g key={k}>
            <circle cx={cx} cy={cy} r={R} className={mine ? 'bg-checker mine' : 'bg-checker theirs'} />
            {k === shown - 1 && count > 5 && (
              <text x={cx} y={cy + 5} textAnchor="middle" className={mine ? 'bg-count mine' : 'bg-count theirs'}>{count}</text>
            )}
          </g>
        )
      })}
    </>
  )
}

export function BackgammonBoard({ you, them, cube }: Props) {
  const sum = (s: readonly number[]) => s.reduce((a, n) => a + n, 0)
  const barX = EDGE + 6 * POINT_W + BAR / 2
  const cubeY = cube.at === 'you' ? H - EDGE - 40 : cube.at === 'them' ? EDGE + 4 : H / 2 - 18
  const cubeX = cube.at === 'offered' ? colX(8) + POINT_W / 2 : cube.at === 'middle' ? barX - 18 : W - EDGE - (TRAY - 8) / 2 - 18
  const describe = (s: readonly number[]) =>
    s.map((n, i) => (n ? `${n} on ${i === 24 ? 'the bar' : `the ${i + 1}-point`}` : '')).filter(Boolean).join(', ')

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="bg-board"
      role="img"
      aria-label={`Backgammon position. You: ${describe(you)}. Opponent, counted from their side: ${describe(them)}.`}
    >
      <rect x="0" y="0" width={W} height={H} rx="10" className="bg-frame" />
      <rect x={EDGE} y={EDGE} width={6 * POINT_W} height={H - EDGE * 2} className="bg-felt" />
      <rect x={EDGE + 6 * POINT_W + BAR} y={EDGE} width={6 * POINT_W} height={H - EDGE * 2} className="bg-felt" />
      <rect x={W - EDGE - TRAY + 8} y={EDGE} width={TRAY - 8} height={H - EDGE * 2} className="bg-felt" />
      {Array.from({ length: 12 }, (_, i) => {
        const x = colX(i)
        return (
          <g key={i}>
            <polygon points={`${x},${EDGE} ${x + POINT_W},${EDGE} ${x + POINT_W / 2},${EDGE + POINT_H}`} className={i % 2 ? 'bg-point a' : 'bg-point b'} />
            <polygon points={`${x},${H - EDGE} ${x + POINT_W},${H - EDGE} ${x + POINT_W / 2},${H - EDGE - POINT_H}`} className={i % 2 ? 'bg-point b' : 'bg-point a'} />
          </g>
        )
      })}
      {Array.from({ length: 24 }, (_, i) => {
        const { col, top } = place(i + 1)
        return <text key={i} x={colX(col) + POINT_W / 2} y={top ? 9 : H - 2} textAnchor="middle" className="bg-num">{i + 1}</text>
      })}
      {Array.from({ length: 24 }, (_, i) => {
        const { col, top } = place(i + 1)
        const cx = colX(col) + POINT_W / 2
        const mine = you[i] ?? 0
        const theirs = them[23 - i] ?? 0 // their point 24-i is your point i+1
        return (
          <g key={i}>
            {mine > 0 && <Stack cx={cx} count={mine} top={top} mine />}
            {theirs > 0 && <Stack cx={cx} count={theirs} top={top} mine={false} />}
          </g>
        )
      })}
      {/* checkers on the bar: yours wait in the upper half (they re-enter at the top right), theirs in the lower */}
      {(you[24] ?? 0) > 0 && <Stack cx={barX} count={you[24]} top mine fromY={H / 2 - R - 26} />}
      {(them[24] ?? 0) > 0 && <Stack cx={barX} count={them[24]} top={false} mine={false} fromY={H / 2 + R + 26} />}
      <text x={W - EDGE - (TRAY - 8) / 2} y={H - EDGE - 50} textAnchor="middle" className="bg-off">{15 - sum(you)} off</text>
      <text x={W - EDGE - (TRAY - 8) / 2} y={EDGE + 58} textAnchor="middle" className="bg-off">{15 - sum(them)} off</text>
      <g transform={`translate(${cubeX}, ${cubeY})`}>
        <rect width="36" height="36" rx="6" className="bg-cube" />
        <text x="18" y="24" textAnchor="middle" className="bg-cube-text">{cube.value}</text>
      </g>
    </svg>
  )
}
