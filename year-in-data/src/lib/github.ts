// Commits for one repository over the year, through the GitHub REST API.
// Parsing and summarising are pure; fetchRepoYear is the only function that touches the network.
// Only counts and dates are kept: commit messages and author names are never stored.
import { type ISODate, addDays, fmtDate, isDate, monthKey, monthsIn } from './dates';
import type { Build, FolderSummary, RepoSummary } from './types';
import { type YearWindow, inWindow } from './window';

export type GhFetcher = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

export const PER_PAGE = 100;
/** Pages read per listing before giving up and marking the counts as a floor. */
export const MAX_PAGES = 20;

export const isRepoName = (s: string): boolean => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(s.trim());

/** Commit dates (UTC day of the author date) from a "list commits" response. */
export function parseCommitDates(body: unknown): ISODate[] {
  if (!Array.isArray(body)) throw new Error('GitHub sent something that is not a list of commits.');
  const out: ISODate[] = [];
  for (const c of body as { commit?: { author?: { date?: string } | null; committer?: { date?: string } | null } }[]) {
    const stamp = c?.commit?.author?.date ?? c?.commit?.committer?.date;
    const day = typeof stamp === 'string' ? new Date(stamp).toISOString().slice(0, 10) : '';
    if (isDate(day)) out.push(day);
  }
  return out;
}

/** Top-level folder names from a "repository contents" response for the root. */
export function parseTopFolders(body: unknown): string[] {
  if (!Array.isArray(body)) throw new Error('GitHub sent something that is not a folder listing.');
  return (body as { name?: string; type?: string }[])
    .filter((e) => e?.type === 'dir' && typeof e.name === 'string' && !e.name.startsWith('.'))
    .map((e) => e.name!)
    .sort((a, b) => a.localeCompare(b));
}

export interface FolderCommits {
  name: string;
  /** Commit days inside the window that touched the folder. */
  days: ISODate[];
  /** Whether any commit touched the folder before the window opened. */
  hadEarlier: boolean;
}

export function summariseRepo(repo: string, w: YearWindow, commitDays: ISODate[], folders: FolderCommits[], truncated: boolean, fetchedAt: number): RepoSummary {
  const byMonth: Record<string, number> = Object.fromEntries(monthsIn(w.start, w.end).map((m) => [m, 0]));
  let total = 0;
  for (const d of commitDays) {
    if (!inWindow(d, w)) continue;
    total += 1;
    byMonth[monthKey(d)] += 1;
  }
  const summary: FolderSummary[] = folders
    .map((f) => {
      const days = f.days.filter((d) => inWindow(d, w)).sort();
      return { name: f.name, commits: days.length, ...(days[0] ? { first: days[0] } : {}), isNew: !f.hadEarlier && days.length > 0 };
    })
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
  return { repo, fetchedAt, total, truncated, byMonth, folders: summary };
}

/** Folders first committed to during the year, as builds for the owner to confirm. */
export function proposeBuilds(summary: RepoSummary, existing: Build[]): Omit<Build, 'id'>[] {
  const have = new Set(existing.map((b) => b.name.trim().toLowerCase()));
  return summary.folders
    .filter((f) => f.isNew && f.first !== undefined && !have.has(f.name.toLowerCase()))
    .sort((a, b) => (a.first! < b.first! ? -1 : a.first! > b.first! ? 1 : a.name.localeCompare(b.name)))
    .map((f) => ({ name: f.name, shipped: f.first!, link: `https://github.com/${summary.repo}/tree/HEAD/${encodeURIComponent(f.name)}`, note: `First commit ${fmtDate(f.first!)}, ${f.commits} ${f.commits === 1 ? 'commit' : 'commits'} in the year.` }));
}

function describeFailure(status: number, hasToken: boolean, remaining: string | null): string {
  if (status === 401) return 'GitHub rejected the token.';
  if ((status === 403 || status === 429) && remaining === '0') return hasToken ? 'GitHub rate limit reached. Try again within the hour.' : 'GitHub rate limit reached (60 requests an hour without a token). Add a token or try again within the hour.';
  if (status === 403) return 'GitHub refused access to this repository.';
  if (status === 404) return hasToken ? 'GitHub cannot find this repository with this token.' : 'GitHub cannot find this repository. If it is private, add a token.';
  if (status === 409) return 'The repository is empty.';
  return `GitHub answered ${status}.`;
}

/**
 * One request for the root listing, then paged commit listings for the whole
 * repository and for each top-level folder, plus one request per folder to see
 * whether it existed before the year. A commit touching two folders counts in both.
 */
export async function fetchRepoYear(fetcher: GhFetcher, repo: string, w: YearWindow, until: ISODate, token: string | null, now: number): Promise<RepoSummary> {
  const name = repo.trim();
  if (!isRepoName(name)) throw new Error('Write the repository as owner/name.');
  const api = `https://api.github.com/repos/${name}`;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const get = async (url: string): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetcher(url, { headers });
    } catch {
      throw new Error('Could not reach GitHub.');
    }
    if (!res.ok) throw new Error(describeFailure(res.status, Boolean(token), res.headers.get('x-ratelimit-remaining')));
    return res.json();
  };
  let truncated = false;
  const since = `${w.start}T00:00:00Z`;
  const before = `${until}T00:00:00Z`;
  const listDays = async (path: string | null): Promise<ISODate[]> => {
    const days: ISODate[] = [];
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) { truncated = true; break; }
      const q = `since=${since}&until=${before}&per_page=${PER_PAGE}&page=${page}${path ? `&path=${encodeURIComponent(path)}` : ''}`;
      const body = await get(`${api}/commits?${q}`);
      days.push(...parseCommitDates(body));
      if ((body as unknown[]).length < PER_PAGE) break;
    }
    return days;
  };

  const folders = parseTopFolders(await get(`${api}/contents/`));
  const commitDays = await listDays(null);
  const perFolder: FolderCommits[] = [];
  for (const folder of folders) {
    const days = await listDays(folder);
    const earlier = (await get(`${api}/commits?until=${addDays(w.start, -1)}T23:59:59Z&per_page=1&path=${encodeURIComponent(folder)}`)) as unknown[];
    perFolder.push({ name: folder, days, hadEarlier: Array.isArray(earlier) && earlier.length > 0 });
  }
  return summariseRepo(name, w, commitDays, perFolder, truncated, now);
}
