import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs, runSwitch } from './cli.ts';
import type { CliIo } from './cli.ts';
import { parseIcs } from './ics.ts';
import { blankDoc } from './model.ts';
import type { Doc } from './model.ts';

function fakeIo(over: Partial<CliIo> = {}) {
  const logs: string[] = [];
  const files: Record<string, string> = {};
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const io: CliIo = {
    env: {},
    // 23:30 UTC on 23 Nov: still the 23rd in London, already the 24th in Istanbul.
    now: new Date('2026-11-23T23:30:00Z'),
    log: (l) => logs.push(l),
    readFile: (p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    writeFile: (p, t) => {
      files[p] = t;
    },
    fetch: async () => {
      throw new Error('network not expected');
    },
    ...over,
  };
  return { io, logs, files, calls };
}

describe('arguments', () => {
  it('reads the city and options', () => {
    expect(parseArgs(['istanbul'])).toMatchObject({ city: 'istanbul', out: './out', file: null, sync: true, error: null });
    expect(parseArgs(['LDN', '--out', 'x', '--file', 'b.json', '--date', '2026-12-12', '--no-sync'])).toMatchObject({ city: 'london', out: 'x', file: 'b.json', date: '2026-12-12', sync: false, error: null });
  });

  it('explains what is wrong', () => {
    expect(parseArgs([]).error).toMatch(/which city/);
    expect(parseArgs(['paris']).error).toMatch(/not a city/);
    expect(parseArgs(['london', '--date', 'tomorrow']).error).toMatch(/YYYY-MM-DD/);
    expect(parseArgs(['london', '--out']).error).toMatch(/needs a value/);
    expect(parseArgs(['london', '--wat']).error).toMatch(/Unknown option/);
    expect(parseArgs(['--help'])).toMatchObject({ help: true, error: null });
  });
});

describe('runSwitch', () => {
  it('works from the starter templates when nothing is configured', async () => {
    const { io, logs, files } = fakeIo();
    const r = await runSwitch(['istanbul'], io);
    expect(r.code).toBe(0);
    expect(r.source).toBe('starter');
    expect(r.doc?.mode).toBe('istanbul');
    // The switch date is today in the destination city.
    expect(r.doc?.switchedOn).toBe('2026-11-24');
    expect(Object.keys(files).sort()).toEqual(['./out/checklist-istanbul-2026-11-24.md', './out/routine-istanbul.ics']);
    expect(files['./out/checklist-istanbul-2026-11-24.md']).toContain('- [ ] Passport and ID card');
    expect(parseIcs(files['./out/routine-istanbul.ics'])).toHaveLength(7);
    const out = logs.join('\n');
    expect(out).toContain('Istanbul mode, switched on Tue 24 Nov 2026');
    expect(out).toContain('Routine order');
    expect(out).toContain('Court: not set');
    expect(out).toContain('Packing for Istanbul');
    expect(out).toContain('Landing');
    expect(out).toContain('no sync variables set');
  });

  it('uses London’s date for London', async () => {
    const { io } = fakeIo();
    expect((await runSwitch(['london'], io)).doc?.switchedOn).toBe('2026-11-23');
  });

  it('works from a backup file and writes the flipped document next to the checklists', async () => {
    const { io, files, logs } = fakeIo();
    const backup = blankDoc();
    backup.profiles.london.court = { name: 'Park courts', slot: 'Tue 18:30' };
    backup.profiles.london.packing = [{ id: 'k', text: 'Keys' }];
    backup.stays = [{ id: 's', city: 'london', country: 'GB', arrive: '2026-11-10', depart: null, source: 'manual' }];
    backup.mode = 'istanbul';
    files['backup.json'] = JSON.stringify(backup);
    const r = await runSwitch(['london', '--file', 'backup.json', '--out', 'o/', '--date', '2026-12-01'], io);
    expect(r.code).toBe(0);
    expect(r.source).toBe('file');
    expect(r.written).toEqual(['o/checklist-london-2026-12-01.md', 'o/routine-london.ics', 'o/two-city-2026-12-01.json']);
    expect(files['o/checklist-london-2026-12-01.md']).toContain('- [ ] Keys');
    expect(logs.join('\n')).toContain('Court: Park courts, Tue 18:30');
    const saved = JSON.parse(files['o/two-city-2026-12-01.json']) as Doc;
    expect(saved.mode).toBe('london');
    expect(saved.stays).toEqual(backup.stays);
    expect(saved.updatedAt).toBe(io.now.getTime());
    expect(files['backup.json']).toBe(JSON.stringify(backup)); // the backup itself is not modified
  });

  it('pulls, flips and pushes the synced document when the three variables are set', async () => {
    const remote = { ...blankDoc(), mode: 'london', updatedAt: 1 } as Doc;
    remote.profiles.istanbul.gym = { name: 'Hotel gym', slot: 'mornings' };
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const { io, logs } = fakeIo({
      env: { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_KEY: 'sb_publishable_test', TWO_CITY_SYNC_CODE: 'abcdef-ghjkmn-pqrstu-vwxyz2' },
      fetch: async (url, init) => {
        calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
        return { ok: true, status: 200, text: async () => (url.endsWith('board_get') ? JSON.stringify(remote) : '') };
      },
    });
    const r = await runSwitch(['ist'], io);
    expect(r.code).toBe(0);
    expect(r.source).toBe('sync');
    expect(calls.map((c) => c.url)).toEqual(['https://example.supabase.co/rest/v1/rpc/board_get', 'https://example.supabase.co/rest/v1/rpc/board_put']);
    expect(calls[0].body).toEqual({ p_code: 'abcdef-ghjkmn-pqrstu-vwxyz2' });
    expect(calls[0].headers).toMatchObject({ apikey: 'sb_publishable_test', Authorization: 'Bearer sb_publishable_test' });
    const pushed = calls[1].body.p_data as Doc;
    expect(calls[1].body.p_code).toBe('abcdef-ghjkmn-pqrstu-vwxyz2');
    expect(pushed.mode).toBe('istanbul');
    expect(pushed.updatedAt).toBe(io.now.getTime()); // newer than the copy on any device, so they take it
    expect(pushed.checklists.filter((c) => !c.archived)).toHaveLength(2);
    expect(logs.join('\n')).toContain('Gym:   Hotel gym, mornings');
    expect(logs.join('\n')).toContain('Synced');
  });

  it('skips sync with --no-sync or --file, and reports a failed pull or push', async () => {
    const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k', TWO_CITY_SYNC_CODE: 'c' };
    expect((await runSwitch(['london', '--no-sync'], fakeIo({ env }).io)).source).toBe('starter');

    const down = fakeIo({ env, fetch: async () => ({ ok: false, status: 503, text: async () => '' }) });
    expect((await runSwitch(['london'], down.io)).code).toBe(1);
    expect(down.logs.join('\n')).toContain('Sync failed (503)');
    expect(down.files).toEqual({});

    const pushFails = fakeIo({ env, fetch: async (url) => ({ ok: url.endsWith('board_get'), status: url.endsWith('board_get') ? 200 : 500, text: async () => '' }) });
    const r = await runSwitch(['london'], pushFails.io);
    expect(r.code).toBe(1);
    expect(Object.keys(pushFails.files)).toHaveLength(2);
    expect(pushFails.logs.join('\n')).toContain('sync push failed');
  });

  it('exits with a usage error for a bad command and prints help', async () => {
    const bad = fakeIo();
    expect((await runSwitch(['paris'], bad.io)).code).toBe(2);
    expect(bad.files).toEqual({});
    const help = fakeIo();
    expect((await runSwitch(['--help'], help.io)).code).toBe(0);
    expect(help.logs[0]).toContain('Usage: city <london|istanbul>');
    const missing = fakeIo();
    expect((await runSwitch(['london', '--file', 'nope.json'], missing.io)).code).toBe(1);
    expect(missing.logs[0]).toContain('Could not load the document');
  });
});

describe('the command itself', () => {
  it('runs under plain node and writes the two files', () => {
    const out = mkdtempSync(join(tmpdir(), 'two-city-'));
    try {
      const env = { ...process.env };
      delete env.SUPABASE_URL;
      delete env.SUPABASE_KEY;
      delete env.TWO_CITY_SYNC_CODE;
      const stdout = execFileSync(process.execPath, ['cli/switch.mjs', 'london', '--out', out, '--date', '2026-11-23'], { encoding: 'utf8', env });
      expect(stdout).toContain('London mode, switched on Mon 23 Nov 2026');
      expect(existsSync(join(out, 'checklist-london-2026-11-23.md'))).toBe(true);
      expect(readFileSync(join(out, 'routine-london.ics'), 'utf8')).toContain('DTSTART;TZID=Europe/London:20261123T070000');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
