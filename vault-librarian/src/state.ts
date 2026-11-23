// What the librarian remembers between runs: dismissed suggestions, what earlier weekly reports
// already showed, and what each source pack contained. One JSON file in the vault's output folder.
import fs from 'node:fs';
import type { Config } from './config.js';
import { resolveInside, writeFileAtomic } from './paths.js';

export const STATE_FILE = 'librarian-state.json';

export interface Dismissal {
  kind: 'pair' | 'orphan' | 'unresolved' | 'mention';
  label: string;
  on: string;
}

export interface PackRecord {
  date: string;
  /** Note path -> its modified date when the pack was built. */
  sources: Record<string, string>;
}

export interface State {
  version: 1;
  dismissed: Record<string, Dismissal>;
  /** Suggestion id -> the first and the latest ISO week a saved weekly report showed it. */
  suggested: Record<string, { first: string; last: string }>;
  /** Topic name -> saved packs, oldest first. */
  packs: Record<string, PackRecord[]>;
}

export function emptyState(): State {
  return { version: 1, dismissed: {}, suggested: {}, packs: {} };
}

export function statePath(config: Config): string {
  return resolveInside(config.vault, `${config.outputFolder}/${STATE_FILE}`);
}

export function loadState(config: Config): State {
  let raw: string;
  try {
    raw = fs.readFileSync(statePath(config), 'utf8');
  } catch {
    return emptyState();
  }
  try {
    const data = JSON.parse(raw) as Partial<State>;
    return {
      version: 1,
      dismissed: data.dismissed && typeof data.dismissed === 'object' ? data.dismissed : {},
      suggested: data.suggested && typeof data.suggested === 'object' ? data.suggested : {},
      packs: data.packs && typeof data.packs === 'object' ? data.packs : {},
    };
  } catch {
    throw new Error(`The state file is not valid JSON: ${statePath(config)}. Fix or delete it (deleting forgets dismissals).`);
  }
}

export function saveState(config: Config, state: State): void {
  writeFileAtomic(statePath(config), `${JSON.stringify(state, null, 2)}\n`);
}
