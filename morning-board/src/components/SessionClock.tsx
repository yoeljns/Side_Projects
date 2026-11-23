import { useEffect, useState } from 'react'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Elapsed time against the session target. It only informs; nothing is cut off when time runs out. */
export function SessionClock({ startedAt, frozenAt, minutes }: { startedAt: number; frozenAt?: number; minutes: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (frozenAt !== undefined) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [frozenAt])
  // A session left overnight should not show hours: cap the display at the day it belongs to.
  const elapsed = Math.min(frozenAt ?? Math.max(0, (now - startedAt) / 1000), 99 * 60)
  return (
    <span className={`clock${elapsed > minutes * 60 ? ' over' : ''}`} aria-label="Session time">
      {mmss(elapsed)} <span className="muted">/ {minutes}:00</span>
    </span>
  )
}
