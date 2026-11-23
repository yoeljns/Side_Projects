// Optional sync through Supabase. A random sync code is the only credential:
// every device that knows it reads and writes the same document.
import type { State } from './store.ts'

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const syncAvailable = Boolean(URL_BASE && KEY)

/** What is stored remotely: everything except the code itself. */
export type Remote = Omit<State, 'syncCode'>

async function rpc(fn: string, body: object): Promise<unknown> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY!, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Sync failed (${res.status})`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const pull = async (code: string) => (await rpc('board_get', { p_code: code })) as Remote | null

export async function push(code: string, state: State): Promise<void> {
  const { syncCode: _omit, ...data } = state
  await rpc('board_put', { p_code: code, p_data: data })
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // no look-alikes

export function newSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('').replace(/(.{6})(?=.)/g, '$1-')
}

export const isSyncCode = (s: string) => /^[a-z0-9-]{20,64}$/.test(s)

/** A link that switches another device onto the same code. The code sits in the fragment, which is never sent to a server. */
export const syncLink = (code: string) => `${location.origin}${location.pathname}#sync=${code}`

export function codeFromLocation(): string | null {
  const m = /^#sync=([a-z0-9-]+)$/.exec(location.hash)
  return m && isSyncCode(m[1]) ? m[1] : null
}
