#!/usr/bin/env node
// vault-librarian: MCP server (stdio) and command line over one Obsidian vault.
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadConfig } from './config.js';
import { absoluteOutput, Librarian, NoteNotFoundError } from './librarian.js';
import { TopicError } from './pack.js';
import { PathError } from './paths.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

const HELP = `vault-librarian ${SERVER_VERSION}

Usage: vault-librarian [command] [options]

Commands
  serve              Run the MCP server on stdio (default when no command is given)
  weekly             Build the weekly link suggestions and save them in the vault
  pack <topic>       Build a source pack for a preset topic or a free query and save it
  dismiss <id>       Dismiss a weekly suggestion by id (--undo restores it)
  index              Walk the vault and refresh the index cache
  stats              Show what the index holds
  topics             List the configured topics

Options
  --vault <path>     The vault folder. Otherwise VAULT_PATH, otherwise the current folder
                     when it holds .obsidian or vault-librarian.config.json
  --config <file>    A config file kept outside the vault root (it may name the vault)
  --today <date>     Treat YYYY-MM-DD as today (to reproduce or backfill a report)
  --limit <n>        weekly: number of pairs
  --old-days <n>     weekly: days without modification before a note counts as old
  --max-sources <n>  pack: number of source notes
  --stdout           weekly, pack: print the Markdown and save nothing
  --no-cache         Do not read or write the index cache
  --undo             dismiss: restore the suggestion
  --json             stats: print JSON
  -h, --help         Show this help
  -v, --version      Show the version
`;

function fail(message: string): never {
  process.stderr.write(`vault-librarian: ${message}\n`);
  process.exit(1);
}

function intOption(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(`--${name} needs a whole number above zero, got "${value}".`);
  return n;
}

function main(): void {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        vault: { type: 'string' },
        config: { type: 'string' },
        today: { type: 'string' },
        limit: { type: 'string' },
        'old-days': { type: 'string' },
        'max-sources': { type: 'string' },
        stdout: { type: 'boolean', default: false },
        'no-cache': { type: 'boolean', default: false },
        undo: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (e) {
    fail(`${e instanceof Error ? e.message : String(e)}\nRun vault-librarian --help for the options.`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  const command = positionals[0] ?? 'serve';
  if (!['serve', 'weekly', 'pack', 'dismiss', 'index', 'stats', 'topics'].includes(command)) {
    fail(`Unknown command "${command}". Run vault-librarian --help.`);
  }

  const config = loadConfig({ vault: values.vault, configFile: values.config });
  const warn = (message: string) => process.stderr.write(`vault-librarian: ${message}\n`);
  const librarian = new Librarian(config, { cache: !values['no-cache'], warn, refreshMs: command === 'serve' ? 2000 : 60_000 });
  const out = (s: string) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);

  switch (command) {
    case 'serve': {
      // stdout carries the protocol; everything for a human goes to stderr.
      serveStdio(() => createServer(librarian), { onerror: (e) => warn(e.message) });
      warn(`${SERVER_NAME} ${SERVER_VERSION} serving ${config.vault} on stdio`);
      return;
    }
    case 'weekly': {
      const result = librarian.weekly({
        today: values.today,
        limit: intOption(values.limit, 'limit'),
        oldAfterDays: intOption(values['old-days'], 'old-days'),
        write: !values.stdout,
      });
      if (values.stdout) out(result.markdown);
      else {
        const r = result.report;
        out(`${absoluteOutput(config, result.written!)}`);
        out(`${r.week}: ${r.pairs.length} pairs, ${r.orphans.length} orphans, ${r.unresolved.length} notes waiting to be written, ${r.mentions.length} unlinked mentions.`);
      }
      return;
    }
    case 'pack': {
      const topic = positionals.slice(1).join(' ').trim();
      if (!topic) fail(`pack needs a topic: one of ${Object.keys(config.topics).join(', ')}, or a free query in quotes.`);
      const result = librarian.pack(topic, { today: values.today, maxSources: intOption(values['max-sources'], 'max-sources'), write: !values.stdout });
      if (result.pack.sources.length === 0) fail(`No notes match the topic "${topic}".`);
      if (values.stdout) out(result.markdown);
      else {
        out(`${absoluteOutput(config, result.written!)}`);
        out(`${result.pack.sources.length} sources in ${result.pack.groups.length} groups, ${result.pack.sources.reduce((n, s) => n + s.excerpts.length, 0)} excerpts.`);
      }
      return;
    }
    case 'dismiss': {
      const id = positionals[1];
      if (!id) fail('dismiss needs a suggestion id, e.g. vault-librarian dismiss p-1a2b3c4d');
      const result = librarian.dismiss({ id }, { undo: values.undo, today: values.today });
      out(`${result.dismissed ? 'Dismissed' : 'Restored'} ${result.id} (${result.label}).`);
      return;
    }
    case 'index': {
      const { index } = librarian.load(true);
      const s = index.stats;
      out(`${index.notes.length} notes, ${index.attachments.length} attachments: ${s.parsed} parsed, ${s.reused} from cache, ${s.removed} removed, ${s.ms} ms.`);
      if (s.skippedSymlinks) out(`${s.skippedSymlinks} symlinks skipped (never followed).`);
      out(s.cacheFile ? `Cache: ${s.cacheFile}` : 'Cache: off');
      return;
    }
    case 'topics': {
      for (const t of Object.values(config.topics)) {
        out(`${t.name}: ${t.title} (tags ${t.seedTags.map((x) => `#${x}`).join(' ') || 'none'}; ${t.seedNotes.length} seed notes; ${t.keyTerms.length} key terms)`);
      }
      return;
    }
    case 'stats': {
      const s = librarian.stats();
      if (values.json) {
        out(JSON.stringify(s, null, 2));
        return;
      }
      out(`Vault            ${s.vault}`);
      out(`Config           ${s.configFile ?? 'none (defaults)'}`);
      out(`Output folder    ${s.outputFolder}`);
      out(`Notes            ${s.notes} (${s.dailyNotes} daily, ${s.emptyNotes} without text)`);
      out(`Attachments      ${s.attachments}`);
      out(`Words            ${s.words} (${s.distinctTerms} distinct terms)`);
      out(`Links            ${s.links} resolved, ${s.brokenAnchors} with a missing heading or block`);
      out(`Unresolved       ${s.unresolvedTargets} missing notes, ${s.missingAttachments} missing attachments`);
      out(`Orphans          ${s.orphans}`);
      out(`Modified         ${s.oldestModified ?? 'n/a'} to ${s.newestModified ?? 'n/a'}`);
      out(`Top tags         ${s.topTags.map((t) => `#${t.tag} (${t.count})`).join(', ') || 'none'}`);
      out(`Topics           ${s.topics.join(', ')}`);
      out(`Dismissed        ${s.dismissed}`);
      out(`Index            ${s.index.parsed} parsed, ${s.index.reused} from cache, ${s.index.ms} ms`);
      if (s.frontmatterErrors.length) out(`Bad frontmatter  ${s.frontmatterErrors.join(', ')}`);
      return;
    }
  }
}

try {
  main();
} catch (e) {
  if (e instanceof ConfigError || e instanceof TopicError || e instanceof NoteNotFoundError || e instanceof PathError) fail(e.message);
  fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
}
