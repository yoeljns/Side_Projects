// Configuration: vault-librarian.config.json in the vault root, validated, with defaults for everything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as z from 'zod/v4';
import { cleanRelative, PathError } from './paths.js';

export const CONFIG_FILE = 'vault-librarian.config.json';

const SubThemeSchema = z.strictObject({
  name: z.string().min(1),
  tags: z.array(z.string()).default([]),
  terms: z.array(z.string()).default([]),
});

const TopicSchema = z.strictObject({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  seedTags: z.array(z.string()).default([]),
  seedNotes: z.array(z.string()).default([]),
  keyTerms: z.array(z.string()).default([]),
  subThemes: z.array(SubThemeSchema).default([]),
});

const ConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  vault: z.string().optional(),
  outputFolder: z.string().min(1).default('Librarian'),
  cacheDir: z.string().min(1).nullable().default(null),
  ignore: z.array(z.string()).default([]),
  dailyNotesFolder: z.string().nullable().default('Daily'),
  questionTags: z.array(z.string()).default(['question', 'todo', 'open-question']),
  similarity: z
    .strictObject({
      textWeight: z.number().min(0).max(1).default(0.7),
      tagWeight: z.number().min(0).max(1).default(0.15),
      neighbourWeight: z.number().min(0).max(1).default(0.15),
    })
    .prefault({}),
  weekly: z
    .strictObject({
      oldAfterDays: z.number().int().min(1).default(90),
      windowDays: z.number().int().min(1).max(31).default(7),
      limit: z.number().int().min(1).max(50).default(10),
      minScore: z.number().min(0).max(1).default(0.12),
      maxPerNote: z.number().int().min(1).default(2),
      repeatAfterWeeks: z.number().int().min(0).default(6),
      includeDailyNotes: z.boolean().default(false),
      minWords: z.number().int().min(0).default(30),
      unresolvedMinSources: z.number().int().min(1).default(2),
      orphanLimit: z.number().int().min(0).max(50).default(5),
      mentionLimit: z.number().int().min(0).max(50).default(10),
    })
    .prefault({}),
  packs: z
    .strictObject({
      maxSources: z.number().int().min(1).max(100).default(25),
      excerptsPerSource: z.number().int().min(1).max(10).default(3),
      maxExcerptChars: z.number().int().min(100).max(5000).default(700),
      minRelevance: z.number().min(0).max(1).default(0.15),
    })
    .prefault({}),
  topics: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'topic names are lower-case letters, digits and hyphens'), TopicSchema).default({}),
});

export type Topic = z.infer<typeof TopicSchema> & { name: string; title: string };
export type SubTheme = z.infer<typeof SubThemeSchema>;
type RawConfig = z.infer<typeof ConfigSchema>;

export interface Config extends Omit<RawConfig, 'topics' | 'vault' | '$schema' | 'cacheDir'> {
  /** Absolute, symlink-resolved vault root. */
  vault: string;
  cacheDir: string;
  /** Where the settings came from, for `stats`. */
  configPath: string | null;
  topics: Record<string, Topic>;
}

/** The two essay topics. Only tags and terms: seed notes belong to a particular vault, so they come from the config file. */
export const BUILT_IN_TOPICS: Record<string, z.input<typeof TopicSchema>> = {
  desire: {
    title: 'Desire',
    description: 'Material for the essay on desire.',
    seedTags: ['desire'],
    seedNotes: [],
    keyTerms: ['desire', 'wanting', 'want', 'longing', 'lack', 'imitation', 'mimetic', 'envy', 'rivalry', 'satisfaction', 'pleasure', 'arzu', 'istek', 'taklit', 'haz'],
  },
  cycles: {
    title: 'Cycles',
    description: 'Material for the essay on cycles: long debt, commodity and technology cycles.',
    seedTags: ['cycles'],
    seedNotes: [],
    keyTerms: ['cycle', 'debt', 'credit', 'leverage', 'deleveraging', 'boom', 'bust', 'bubble', 'commodity', 'supercycle', 'technology', 'wave', 'döngü', 'borç', 'kredi', 'emtia'],
    subThemes: [
      { name: 'Debt', tags: ['cycles/debt', 'debt'], terms: ['debt', 'credit', 'leverage', 'deleveraging', 'default', 'borç', 'kredi'] },
      { name: 'Commodities', tags: ['cycles/commodities', 'commodities'], terms: ['commodity', 'supercycle', 'mine', 'oil', 'copper', 'supply', 'emtia'] },
      { name: 'Technology', tags: ['cycles/technology', 'technology'], terms: ['technology', 'innovation', 'installation', 'deployment', 'hype', 'teknoloji'] },
    ],
  },
};

export class ConfigError extends Error {}

function defaultCacheDir(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), '.cache');
  return path.join(base, 'vault-librarian');
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ConfigError(`Could not read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface LoadOptions {
  /** --vault */
  vault?: string;
  /** --config: a config file outside the vault root; may name the vault in its `vault` field. */
  configFile?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/**
 * Finds the vault (--vault, then VAULT_PATH, then the `vault` field of an explicit --config file, then the
 * working directory when it holds a config file or an .obsidian folder) and loads its settings.
 */
export function loadConfig(options: LoadOptions = {}): Config {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const explicitFile = options.configFile ?? env.VAULT_LIBRARIAN_CONFIG;
  const explicit = explicitFile ? readJson(path.resolve(cwd, explicitFile)) : undefined;
  const explicitVault =
    explicit && typeof explicit === 'object' && typeof (explicit as { vault?: unknown }).vault === 'string'
      ? path.resolve(path.dirname(path.resolve(cwd, explicitFile as string)), (explicit as { vault: string }).vault)
      : undefined;

  let vault = options.vault ?? (env.VAULT_PATH?.trim() || undefined) ?? explicitVault;
  if (!vault && (fs.existsSync(path.join(cwd, CONFIG_FILE)) || fs.existsSync(path.join(cwd, '.obsidian')))) vault = cwd;
  if (!vault) {
    throw new ConfigError(
      'No vault given. Pass --vault <path>, set VAULT_PATH, or run from the vault folder (one that holds .obsidian or vault-librarian.config.json).',
    );
  }
  let root: string;
  try {
    root = fs.realpathSync(path.resolve(cwd, vault));
    if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new ConfigError(`Vault folder not found: ${path.resolve(cwd, vault)}`);
  }

  const inVault = path.join(root, CONFIG_FILE);
  const configPath = explicitFile ? path.resolve(cwd, explicitFile) : fs.existsSync(inVault) ? inVault : null;
  const raw = explicit ?? (configPath ? readJson(configPath) : {});
  return buildConfig(root, raw, configPath, env);
}

/** Validates raw settings against the schema and fills in defaults. Exposed for tests. */
export function buildConfig(root: string, raw: unknown, configPath: string | null = null, env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid ${configPath ?? CONFIG_FILE}:\n${issues}`);
  }
  const c = parsed.data;

  let outputFolder: string;
  try {
    outputFolder = cleanRelative(c.outputFolder);
  } catch (e) {
    throw new ConfigError(`outputFolder: ${e instanceof PathError ? e.message : String(e)}`);
  }
  if (!outputFolder || outputFolder.split('/').some((p) => p.startsWith('.'))) {
    throw new ConfigError('outputFolder must be a folder inside the vault (not the vault root, not a dot-folder).');
  }

  const topics: Record<string, Topic> = {};
  const merged = { ...BUILT_IN_TOPICS, ...c.topics };
  for (const [name, def] of Object.entries(merged)) {
    const t = TopicSchema.parse(def);
    topics[name] = { ...t, name, title: t.title ?? name[0].toUpperCase() + name.slice(1) };
  }

  const cacheDir = c.cacheDir
    ? path.resolve(c.cacheDir.replace(/^~(?=$|\/)/, os.homedir()))
    : defaultCacheDir(env);

  return {
    vault: root,
    configPath,
    outputFolder,
    cacheDir,
    ignore: c.ignore,
    dailyNotesFolder: c.dailyNotesFolder ? cleanRelative(c.dailyNotesFolder) || null : null,
    questionTags: c.questionTags,
    similarity: c.similarity,
    weekly: c.weekly,
    packs: c.packs,
    topics,
  };
}
