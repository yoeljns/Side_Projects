import { describe, expect, it } from 'vitest';
import commitsRaw from '../../test/fixtures/github-commits.json?raw';
import contentsRaw from '../../test/fixtures/github-contents.json?raw';
import { type GhFetcher, fetchRepoYear, isRepoName, parseCommitDates, parseTopFolders, proposeBuilds, summariseRepo } from './github';
import { yearWindow } from './window';

const W = yearWindow({ month: 3, day: 10 }, 2026);
const commits = JSON.parse(commitsRaw) as { sha: string; commit: { author: { date: string }; message: string } }[];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe('GitHub responses', () => {
  it('reads commit days in UTC', () => {
    expect(parseCommitDates(commits)).toEqual(['2026-02-20', '2026-01-05', '2025-11-11', '2025-06-30', '2025-06-02', '2025-06-01', '2025-03-10']);
    expect(parseCommitDates([{ commit: { author: { date: '2025-06-30T23:30:00-02:00' } } }])).toEqual(['2025-07-01']);
    expect(parseCommitDates([{ commit: { author: null, committer: { date: '2025-06-30T10:00:00Z' } } }, { sha: 'x' }])).toEqual(['2025-06-30']);
  });
  it('refuses a body that is not a list (an error object, say)', () => {
    expect(() => parseCommitDates({ message: 'Not Found' })).toThrow();
    expect(() => parseTopFolders({ message: 'Not Found' })).toThrow();
  });
  it('lists top-level folders, without files or dot-folders', () => {
    expect(parseTopFolders(JSON.parse(contentsRaw))).toEqual(['old-tool', 'paper-ledger', 'tide-table']);
  });
  it('checks the owner/name form', () => {
    expect(isRepoName('test-owner/test-repo')).toBe(true);
    expect(isRepoName('test-owner/test.repo_2')).toBe(true);
    expect(isRepoName('test-owner')).toBe(false);
    expect(isRepoName('https://github.com/test-owner/test-repo')).toBe(false);
    expect(isRepoName('a/b/c')).toBe(false);
  });
});

describe('summary of a repository year', () => {
  const s = summariseRepo(
    'test-owner/test-repo',
    W,
    ['2026-03-10', '2026-02-20', '2026-01-05', '2025-11-11', '2025-06-30', '2025-06-02', '2025-06-01', '2025-03-10', '2025-03-09'],
    [
      { name: 'tide-table', days: ['2026-02-20', '2025-06-30', '2025-06-02', '2025-06-01'], hadEarlier: false },
      { name: 'paper-ledger', days: ['2026-01-05'], hadEarlier: false },
      { name: 'old-tool', days: ['2025-11-11'], hadEarlier: true },
      { name: 'untouched', days: [], hadEarlier: false },
    ],
    false,
    1,
  );
  it('counts commits inside the year by month', () => {
    expect(s.total).toBe(7); // 9 Mar 2025 and 10 Mar 2026 are outside
    expect(Object.entries(s.byMonth).filter(([, n]) => n)).toEqual([['2025-03', 1], ['2025-06', 3], ['2025-11', 1], ['2026-01', 1], ['2026-02', 1]]);
    expect(Object.keys(s.byMonth)).toHaveLength(13);
  });
  it('counts by folder and marks folders first committed to in the year', () => {
    expect(s.folders).toEqual([
      { name: 'tide-table', commits: 4, first: '2025-06-01', isNew: true },
      { name: 'old-tool', commits: 1, first: '2025-11-11', isNew: false },
      { name: 'paper-ledger', commits: 1, first: '2026-01-05', isNew: true },
      { name: 'untouched', commits: 0, isNew: false },
    ]);
  });
  it('proposes the new folders as builds, oldest first, skipping names already listed', () => {
    expect(proposeBuilds(s, [])).toEqual([
      { name: 'tide-table', shipped: '2025-06-01', link: 'https://github.com/test-owner/test-repo/tree/HEAD/tide-table', note: 'First commit 1 Jun 2025, 4 commits in the year.' },
      { name: 'paper-ledger', shipped: '2026-01-05', link: 'https://github.com/test-owner/test-repo/tree/HEAD/paper-ledger', note: 'First commit 5 Jan 2026, 1 commit in the year.' },
    ]);
    expect(proposeBuilds(s, [{ id: '1', name: 'Tide-Table', shipped: '2025-07-01' }]).map((b) => b.name)).toEqual(['paper-ledger']);
  });
});

describe('fetching a repository year', () => {
  const byFolder: Record<string, number[]> = { 'tide-table': [0, 3, 4, 5], 'paper-ledger': [1], 'old-tool': [2] };
  const fake = (calls: { url: string; headers: Record<string, string> }[]): GhFetcher => async (url, init) => {
    calls.push({ url, headers: init.headers });
    const u = new URL(url);
    if (u.pathname.endsWith('/contents/')) return json(JSON.parse(contentsRaw));
    const path = u.searchParams.get('path');
    if (!u.searchParams.get('since')) return json(path === 'old-tool' ? [commits[6]] : []); // "anything before the year?"
    return json(path ? byFolder[path].map((i) => commits[i]) : commits);
  };

  it('asks for the window, each folder, and whether each folder existed before', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const s = await fetchRepoYear(fake(calls), ' test-owner/test-repo ', W, W.end, null, 42);
    expect(calls).toHaveLength(1 + 1 + 3 * 2);
    expect(calls[0].url).toBe('https://api.github.com/repos/test-owner/test-repo/contents/');
    expect(calls[1].url).toBe('https://api.github.com/repos/test-owner/test-repo/commits?since=2025-03-10T00:00:00Z&until=2026-03-10T00:00:00Z&per_page=100&page=1');
    expect(calls[2].url).toBe(`${calls[1].url}&path=old-tool`);
    expect(calls[3].url).toBe('https://api.github.com/repos/test-owner/test-repo/commits?until=2025-03-09T23:59:59Z&per_page=1&path=old-tool');
    expect(calls.every((c) => !('Authorization' in c.headers))).toBe(true);
    expect(s).toMatchObject({ repo: 'test-owner/test-repo', fetchedAt: 42, total: 7, truncated: false });
    expect(s.folders.map((f) => [f.name, f.commits, f.isNew])).toEqual([['tide-table', 4, true], ['old-tool', 1, false], ['paper-ledger', 1, true]]);
  });
  it('sends the token as a bearer header and keeps it, and the commit text, out of the result', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const s = await fetchRepoYear(fake(calls), 'test-owner/test-repo', W, W.end, 'ghp_secretsecret', 1);
    expect(calls.every((c) => c.headers.Authorization === 'Bearer ghp_secretsecret')).toBe(true);
    expect(calls.every((c) => !c.url.includes('ghp_'))).toBe(true);
    const stored = JSON.stringify(s);
    expect(stored).not.toContain('ghp_');
    expect(stored).not.toContain('harmonic');
    expect(stored).not.toContain('example.invalid');
  });
  it('follows pages until a short one', async () => {
    const page = (n: number) => Array.from({ length: n }, () => commits[4]);
    const pages: string[] = [];
    const fetcher: GhFetcher = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/contents/')) return json([]);
      pages.push(u.searchParams.get('page')!);
      return json(page(u.searchParams.get('page') === '3' ? 30 : 100));
    };
    const s = await fetchRepoYear(fetcher, 'test-owner/test-repo', W, W.end, null, 1);
    expect(pages).toEqual(['1', '2', '3']);
    expect([s.total, s.truncated]).toEqual([230, false]);
  });
  it('stops at the page cap and says the count is a floor', async () => {
    const full = Array.from({ length: 100 }, () => commits[4]);
    const fetcher: GhFetcher = async (url) => (new URL(url).pathname.endsWith('/contents/') ? json([]) : json(full));
    const s = await fetchRepoYear(fetcher, 'test-owner/test-repo', W, W.end, null, 1);
    expect([s.total, s.truncated]).toEqual([2000, true]);
  });
  it('explains failures in words', async () => {
    const failing = (status: number, headers: Record<string, string> = {}): GhFetcher => async () => json({ message: 'x' }, status, headers);
    const run = (f: GhFetcher, token: string | null = null) => fetchRepoYear(f, 'test-owner/test-repo', W, W.end, token, 1);
    await expect(run(failing(404))).rejects.toThrow('GitHub cannot find this repository. If it is private, add a token.');
    await expect(run(failing(404), 't')).rejects.toThrow('GitHub cannot find this repository with this token.');
    await expect(run(failing(401), 't')).rejects.toThrow('GitHub rejected the token.');
    await expect(run(failing(403, { 'x-ratelimit-remaining': '0' }))).rejects.toThrow(/60 requests an hour/);
    await expect(run(failing(500))).rejects.toThrow('GitHub answered 500.');
    await expect(run(async () => { throw new TypeError('Failed to fetch'); })).rejects.toThrow('Could not reach GitHub.');
    await expect(fetchRepoYear(failing(200), 'not a repo', W, W.end, null, 1)).rejects.toThrow('Write the repository as owner/name.');
  });
});
