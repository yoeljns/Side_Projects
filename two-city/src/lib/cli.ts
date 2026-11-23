// Core of the `city` command (cli/switch.mjs). Everything it touches comes in
// through `io`, so the whole flow is testable without a disk or a network.
import { CITIES, dayIn, isCity, isDay } from './dates.ts';
import type { City, Day } from './dates.ts';
import { blankDoc, normaliseDoc } from './model.ts';
import type { Doc } from './model.ts';
import { checklistMarkdown, flip, routineIcs, switchSummary } from './switch.ts';

export interface CliIo {
  env: Record<string, string | undefined>;
  now: Date;
  log: (line: string) => void;
  readFile: (path: string) => string;
  /** Creates parent directories as needed. */
  writeFile: (path: string, text: string) => void;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}

export interface CliArgs {
  city: City | null;
  file: string | null;
  out: string;
  date: Day | null;
  sync: boolean;
  help: boolean;
  error: string | null;
}

const ALIASES: Record<string, City> = { london: 'london', ldn: 'london', lon: 'london', istanbul: 'istanbul', ist: 'istanbul' };

export function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = { city: null, file: null, out: './out', date: null, sync: true, help: false, error: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) a.error = `${arg} needs a value.`;
      return v ?? '';
    };
    if (arg === '--help' || arg === '-h') a.help = true;
    else if (arg === '--file') a.file = value();
    else if (arg === '--out') a.out = value();
    else if (arg === '--date') {
      const d = value();
      if (isDay(d)) a.date = d;
      else a.error = '--date needs YYYY-MM-DD.';
    } else if (arg === '--no-sync') a.sync = false;
    else if (arg.startsWith('-')) a.error = `Unknown option ${arg}.`;
    else if (ALIASES[arg.toLowerCase()] && !a.city) a.city = ALIASES[arg.toLowerCase()];
    else a.error = `"${arg}" is not a city. Use london or istanbul.`;
  }
  if (!a.help && !a.error && !a.city) a.error = 'Say which city: london or istanbul.';
  return a;
}

export const HELP = `Usage: city <london|istanbul> [options]

Flips Two City to that city: prints the routine order, the court and gym
defaults and fresh packing and landing checklists, and writes
checklist-<city>-<date>.md and routine-<city>.ics to the output directory.

Options
  --file <path>   Work from a backup file downloaded from the app (Settings).
  --out <dir>     Where to write files. Default ./out
  --date <day>    Switch date, YYYY-MM-DD. Default: today in that city.
  --no-sync       Do not read or write the synced document.
  -h, --help      Show this help.

With SUPABASE_URL, SUPABASE_KEY and TWO_CITY_SYNC_CODE set, the synced
document is pulled, flipped and pushed back, so the web app follows.`;

async function rpc(io: CliIo, fn: string, body: object): Promise<unknown> {
  const base = io.env.SUPABASE_URL!.replace(/\/$/, '');
  const key = io.env.SUPABASE_KEY!;
  const res = await io.fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sync failed (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const syncConfigured = (env: CliIo['env']): boolean => Boolean(env.SUPABASE_URL && env.SUPABASE_KEY && env.TWO_CITY_SYNC_CODE);

export interface CliResult {
  code: number;
  doc?: Doc;
  source?: 'sync' | 'file' | 'starter';
  written?: string[];
}

const join = (dir: string, name: string) => `${dir.replace(/\/+$/, '') || '.'}/${name}`;

/** Run the switch. Returns the exit code and, for tests, what was produced. */
export async function runSwitch(argv: string[], io: CliIo): Promise<CliResult> {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(HELP);
    return { code: 0 };
  }
  if (args.error || !args.city) {
    io.log(args.error ?? 'Say which city.');
    io.log('Try: city --help');
    return { code: 2 };
  }
  const city = args.city;
  const useSync = args.sync && !args.file && syncConfigured(io.env);
  let doc: Doc;
  let source: CliResult['source'];
  try {
    if (useSync) {
      const remote = await rpc(io, 'board_get', { p_code: io.env.TWO_CITY_SYNC_CODE });
      doc = normaliseDoc(remote);
      source = 'sync';
      if (!remote) io.log('Nothing is stored under that sync code yet: starting from the starter templates.');
    } else if (args.file) {
      doc = normaliseDoc(JSON.parse(io.readFile(args.file)));
      source = 'file';
    } else {
      doc = blankDoc();
      source = 'starter';
    }
  } catch (e) {
    io.log(`Could not load the document: ${e instanceof Error ? e.message : String(e)}`);
    return { code: 1 };
  }
  if (!isCity(doc.mode)) doc.mode = 'london';

  const today = args.date ?? dayIn(CITIES[city].tz, io.now);
  const next: Doc = { ...flip(doc, city, today), updatedAt: io.now.getTime() };

  io.log(switchSummary(next, city, today));
  io.log('');

  const written: string[] = [];
  const save = (name: string, text: string) => {
    const path = join(args.out, name);
    io.writeFile(path, text);
    written.push(path);
  };
  try {
    save(`checklist-${city}-${today}.md`, checklistMarkdown(next, city, today));
    save(`routine-${city}.ics`, routineIcs(next.profiles[city], city, today, io.now.toISOString()));
    if (source === 'file') save(`two-city-${today}.json`, JSON.stringify(next, null, 2) + '\n');
  } catch (e) {
    io.log(`Could not write to ${args.out}: ${e instanceof Error ? e.message : String(e)}`);
    return { code: 1, doc: next, source, written };
  }
  io.log('Wrote');
  for (const p of written) io.log(`  ${p}`);

  if (source === 'sync') {
    try {
      await rpc(io, 'board_put', { p_code: io.env.TWO_CITY_SYNC_CODE, p_data: next });
      io.log('Synced: the web app picks this up the next time it is opened or brought to the front.');
    } catch (e) {
      io.log(`The files are written, but the sync push failed: ${e instanceof Error ? e.message : String(e)}`);
      return { code: 1, doc: next, source, written };
    }
  } else if (source === 'file') {
    io.log(`The app is unchanged. To carry the switch over, restore ${join(args.out, `two-city-${today}.json`)} in Settings.`);
  } else {
    io.log('Using the starter templates: no sync variables set and no --file given. The app is unchanged.');
  }
  return { code: 0, doc: next, source, written };
}
