import { useState } from 'react'
import type { Settings } from '../lib/store.ts'

interface Props {
  settings: Settings
  first: boolean
  onSave: (s: Settings) => void
  onCancel?: () => void
}

export function SettingsForm({ settings, first, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(settings)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <form
      className="settings"
      onSubmit={(e) => {
        e.preventDefault()
        if (draft.username.trim()) onSave({ ...draft, username: draft.username.trim() })
      }}
    >
      {first && (
        <>
          <h2>Where do you play?</h2>
          <p className="context">
            Each morning the board reads your latest public games, finds the moves that cost you most, and
            hands them back as puzzles. Stockfish runs in this browser; nothing is uploaded.
          </p>
        </>
      )}
      <div className="row">
        <label>
          Site
          <select value={draft.site} onChange={(e) => set('site', e.target.value as Settings['site'])}>
            <option value="lichess">Lichess</option>
            <option value="chesscom">Chess.com</option>
          </select>
        </label>
        <label className="grow">
          Username
          <input
            value={draft.username}
            onChange={(e) => set('username', e.target.value)}
            placeholder="your handle"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </label>
      </div>
      <div className="row">
        <label>
          Mornings in
          <select value={draft.city} onChange={(e) => set('city', e.target.value as Settings['city'])}>
            <option value="auto">Wherever I am</option>
            <option value="london">London</option>
            <option value="istanbul">Istanbul</option>
          </select>
        </label>
        <label>
          Chess puzzles
          <select value={draft.puzzlesPerDay} onChange={(e) => set('puzzlesPerDay', Number(e.target.value))}>
            {[2, 3, 4, 5, 6, 8].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Cube decisions
          <select value={draft.cubesPerDay} onChange={(e) => set('cubesPerDay', Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
        <button className="primary">{first ? 'Deal my first board' : 'Save'}</button>
      </div>
    </form>
  )
}
