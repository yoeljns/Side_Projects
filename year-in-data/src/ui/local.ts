// Things that stay in this browser only and are never part of the synced document:
// the sync codes of the other apps, and the GitHub token.
import { STORE_KEY } from '../lib/doc';
import type { SourceId } from '../lib/sources';

const CODES = `${STORE_KEY}:source-codes`;
const TOKEN = `${STORE_KEY}:github-token`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private windows: nothing to keep.
  }
}

export function sourceCodes(): Partial<Record<SourceId, string>> {
  try {
    const v = JSON.parse(read(CODES) ?? '{}') as Partial<Record<SourceId, string>>;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
export function setSourceCode(id: SourceId, code: string | null): void {
  const next = { ...sourceCodes() };
  if (code) next[id] = code;
  else delete next[id];
  write(CODES, Object.keys(next).length ? JSON.stringify(next) : null);
}
export const githubToken = (): string => read(TOKEN) ?? '';
export const setGithubToken = (token: string): void => write(TOKEN, token.trim() || null);

/** Today in the device's own time zone, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function download(filename: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
