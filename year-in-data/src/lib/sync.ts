// Optional sync through Supabase, shared with Morning Board: the same two
// functions (board_get / board_put, see morning-board/supabase/migrations)
// hold one JSON document per sync code. A random sync code is the only
// credential: every device that knows it reads and writes the same document.

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
const URL_BASE = env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const KEY = env.VITE_SUPABASE_KEY;

export const syncAvailable = Boolean(URL_BASE && KEY);

async function rpc(fn: string, body: object): Promise<unknown> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY!, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sync failed (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const pull = async <T>(code: string) => (await rpc('board_get', { p_code: code })) as T | null;

export const push = async (code: string, data: object): Promise<void> => {
  await rpc('board_put', { p_code: code, p_data: data });
};

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes

export function newSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes]
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('')
    .replace(/(.{6})(?=.)/g, '$1-');
}

export const isSyncCode = (s: string) => /^[a-z0-9-]{20,64}$/.test(s);

/** A link that switches another device onto the same code. The code sits in the fragment, which is never sent to a server. */
export const syncLink = (code: string) => `${location.origin}${location.pathname}#sync=${code}`;

export function codeFromLocation(): string | null {
  const m = /^#sync=([a-z0-9-]+)$/.exec(location.hash);
  return m && isSyncCode(m[1]) ? m[1] : null;
}
