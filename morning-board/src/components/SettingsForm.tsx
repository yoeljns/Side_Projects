import { useState } from 'react'
import type { Settings } from '../lib/store.ts'
import { syncLink } from '../lib/sync.ts'

export interface SyncControls {
  code?: string
  note: string
  start: () => void
  join: (code: string) => void
  stop: () => void
}

interface Props {
  settings: Settings
  first: boolean
  onSave: (s: Settings) => void
  onCancel?: () => void
  /** Present only when a sync backend is configured. */
  sync?: SyncControls
}

export function SettingsForm({ settings, first, onSave, onCancel, sync }: Props) {
  const [draft, setDraft] = useState(settings)
  const [joinCode, setJoinCode] = useState('')
  const [copied, setCopied] = useState(false)
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
      <div className="row">
        <label className="grow">
          Chess engine
          <select value={draft.engine} onChange={(e) => set('engine', e.target.value as Settings['engine'])}>
            <option value="auto">Automatic: full Stockfish 19 on a computer, lite on a phone</option>
            <option value="full">Full Stockfish 19 (94 MB download, strongest)</option>
            <option value="lite">Stockfish 19 lite (small and quick)</option>
          </select>
        </label>
      </div>
      {sync && (
        <fieldset className="sync">
          <legend>Sync between devices</legend>
          {sync.code ? (
            <>
              <p className="context">
                This device shares its board with every device that uses this code. Open the link on your other
                device, or paste the code into its settings.
              </p>
              <code data-testid="sync-code">{sync.code}</code>
              <div className="actions start">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void navigator.clipboard.writeText(syncLink(sync.code!)).then(() => setCopied(true))}
                >
                  {copied ? 'Link copied' : 'Copy link'}
                </button>
                <button type="button" className="ghost" onClick={sync.stop}>Stop syncing here</button>
              </div>
            </>
          ) : (
            <>
              <p className="context">Keep the same puzzles, reviews and streak on your phone and laptop. No account needed.</p>
              <div className="row">
                <button type="button" className="ghost" onClick={sync.start} disabled={first}>Start syncing this device</button>
                <label className="grow">
                  Or paste a code from another device
                  <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.trim().toLowerCase())} placeholder="xxxxxx-xxxxxx-xxxxxx-xxxxxx" autoCapitalize="none" spellCheck={false} />
                </label>
                <button type="button" className="ghost" onClick={() => sync.join(joinCode)} disabled={!joinCode}>Join</button>
              </div>
            </>
          )}
          {sync.note && <p className="muted">{sync.note}</p>}
        </fieldset>
      )}
      <div className="actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
        <button className="primary">{first ? 'Deal my first board' : 'Save'}</button>
      </div>
    </form>
  )
}
