# Vault Librarian

An MCP server and command-line tool that sits next to an Obsidian vault. Once a week it surfaces links between old notes and new ones, and on request it assembles a source pack for an essay topic: every relevant note, grouped by sub-theme, with the passages that matter quoted word for word.

It runs on your own machine, reads the vault as plain files, and calls no outside service. It never edits a note. The only things it writes are its own reports, into one folder inside the vault, and an index cache outside it.

- **Weekly links**: pairs of notes that are similar but not linked in either direction, with the reason for each (shared terms, shared tags, notes linked with both, and the best-matching passage from each side). Biased toward an old note meeting something touched this week. Also: orphans worth rescuing, missing notes that several notes link to, and titles or aliases written out in plain text without a link.
- **Source packs**: for `desire`, `cycles`, or any free query. An outline by sub-theme; for each source its wikilink, dates, why it was included, and its most relevant passages quoted exactly with their heading; then open questions and what is new since the last pack.
- **Tools for Claude**: search, read, backlinks, related notes, the two reports, topics and stats, exposed over MCP so Claude Code or Claude Desktop can use the vault while you write.

The librarian assembles and cites. It does not summarise, paraphrase, or write essay prose.

## Commands

Needs Node 22 or later.

```bash
npm ci
npm run build    # tsc to dist/
npm test         # builds, then runs the vitest suite (including an end-to-end MCP test)

node dist/cli.js stats  --vault "/path/to/Vault"
node dist/cli.js weekly --vault "/path/to/Vault"            # writes Librarian/Weekly links/2026-W48.md
node dist/cli.js pack cycles --vault "/path/to/Vault"       # writes Librarian/Source packs/cycles 2026-11-23.md
node dist/cli.js pack "boredom and attention #desire" --vault "/path/to/Vault"
node dist/cli.js serve  --vault "/path/to/Vault"            # MCP server on stdio (the default command)
```

`npm link` in this folder puts `vault-librarian` on your PATH, so the same commands read `vault-librarian weekly` and so on.

| Command | What it does |
|---|---|
| `serve` | MCP server on stdio. Default when no command is given. |
| `weekly` | Builds the weekly report and saves it. `--stdout` prints it and saves nothing. `--limit n`, `--old-days n`. |
| `pack <topic>` | Builds a source pack for a preset or a free query and saves it. `--stdout`, `--max-sources n`. |
| `dismiss <id>` | Stops a weekly suggestion from coming back. `--undo` restores it. |
| `index` | Walks the vault and refreshes the cache; prints how many files were parsed and how many re-used. |
| `stats` | Counts: notes, words, links, unresolved links, orphans, top tags. `--json` for JSON. |
| `topics` | Lists the configured topics. |

Common options: `--vault <path>`, `--config <file>`, `--today YYYY-MM-DD` (reproduce or backfill a report), `--no-cache`.

**Where the vault comes from**, in order: `--vault`, the `VAULT_PATH` environment variable, the `vault` field of a config file passed with `--config` (or `VAULT_LIBRARIAN_CONFIG`), and finally the current folder if it holds `.obsidian` or `vault-librarian.config.json`.

## Connecting it to Claude

Use absolute paths; a GUI app does not see your shell's PATH. `which node` gives the path to node.

**Claude Code**

```bash
claude mcp add vault-librarian --scope user \
  --env VAULT_PATH="/Users/you/Documents/Vault" \
  -- node /Users/you/Side_Projects/vault-librarian/dist/cli.js serve
```

Then `/mcp` inside Claude Code should list `vault-librarian` with ten tools. Remove it with `claude mcp remove vault-librarian --scope user`.

**Claude Desktop**: add this to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`) and restart the app.

```json
{
  "mcpServers": {
    "vault-librarian": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/you/Side_Projects/vault-librarian/dist/cli.js", "serve"],
      "env": { "VAULT_PATH": "/Users/you/Documents/Vault" }
    }
  }
}
```

### Tools

| Tool | Reads or writes | Purpose |
|---|---|---|
| `vault_search_notes` | read | Ranked text search with tag, folder/glob and date filters. Paginated. |
| `vault_read_note` | read | A note verbatim, or one heading's section, with its links and backlinks. Paginated by characters. |
| `vault_list_links` | read | Backlinks, outgoing links, or unresolved links (for one note or the whole vault). |
| `vault_related_notes` | read | Notes most similar to one note, with the score broken into its three parts. |
| `vault_weekly_links` | writes only with `write: true` | The weekly report. Saved to `Weekly links/YYYY-Www.md` when asked. |
| `vault_dismiss_suggestion` | writes the state file | Dismiss or restore a suggestion by id, or a pair by its two notes. |
| `vault_build_source_pack` | writes only with `write: true` | The pack as Markdown. Saved to `Source packs/<topic> YYYY-MM-DD.md` when asked. |
| `vault_list_topics`, `vault_get_topic` | read | The topic presets and how each is defined. |
| `vault_stats` | read | Counts, top tags, and how the last index run went. |

Read tools carry the read-only hint. Results are capped at 25,000 characters: lists return fewer items and say how to get the next page (`offset`, or `source_offset` for a pack) rather than cutting text. Every list takes `limit` and `offset`; most tools take `response_format: "json"`.

**Prompts**: `weekly_review` (run the weekly report, save it, walk through it), `source_pack_desire` and `source_pack_cycles` (one per configured topic), and `source_pack` with a `topic` argument. They tell Claude to quote notes exactly and cite them as wikilinks.

## Scheduling the weekly report

`weekly` looks at the seven days ending today and names the file after today's ISO week, so run it at the end of the week: Sunday evening. Run on a Monday morning it would be filed under the new week while covering the old one.

**cron** (`crontab -e`): Sundays at 18:00.

```cron
0 18 * * 0 /usr/local/bin/node /Users/you/Side_Projects/vault-librarian/dist/cli.js weekly --vault "/Users/you/Documents/Vault" >> "$HOME/Library/Logs/vault-librarian.log" 2>&1
```

**launchd** (macOS; unlike cron it runs a missed job when the laptop wakes). Save as `~/Library/LaunchAgents/com.vault-librarian.weekly.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.vault-librarian.weekly</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/you/Side_Projects/vault-librarian/dist/cli.js</string>
    <string>weekly</string>
    <string>--vault</string>
    <string>/Users/you/Documents/Vault</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>0</integer>
    <key>Hour</key><integer>18</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/Users/you/Library/Logs/vault-librarian.log</string>
  <key>StandardErrorPath</key><string>/Users/you/Library/Logs/vault-librarian.log</string>
</dict>
</plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.vault-librarian.weekly.plist
launchctl kickstart gui/$(id -u)/com.vault-librarian.weekly   # run it once now to check
launchctl bootout gui/$(id -u)/com.vault-librarian.weekly     # to remove
```

Replace `/usr/local/bin/node` with the output of `which node` (with nvm it is under `~/.nvm/versions/node/...`). If the vault is in iCloud Drive, Documents or Desktop, macOS may ask to grant the scheduled job access to that folder the first time, or need Full Disk Access for `cron`. The reports are ordinary notes, so they reach the phone with whatever already syncs the vault.

## What it writes, and where

Inside the vault, only under the output folder (default `Librarian/`):

```
Librarian/Weekly links/2026-W48.md         one per ISO week; a re-run in the same week replaces it
Librarian/Source packs/cycles 2026-11-23.md
Librarian/librarian-state.json             dismissals, which pairs past reports showed, what each pack held
```

Outside the vault: the index cache, `~/.cache/vault-librarian/index-<hash>.json` (or `$XDG_CACHE_HOME`, or `cacheDir`). It holds the parsed text of every note, so it is created readable by you only (mode 600); delete it at any time.

Safety rules, each covered by tests:

- Paths from tool arguments must be vault-relative; absolute paths, `..` segments, drive letters and NUL bytes are refused, and a note can only be read if the index holds it.
- Every write goes through one function that resolves the path, follows any symlink that exists on the way, and refuses if the result is outside the vault. A `Librarian` folder that is a symlink to somewhere else is refused.
- Symlinks in the vault are never followed, files or folders.
- `.obsidian`, `.trash`, every other dot-folder, `node_modules`, the output folder itself and the `ignore` globs are not indexed. The librarian's own reports are therefore never treated as notes and cannot feed back into suggestions.

One side effect to know: the reports contain wikilinks, so in Obsidian they show up in backlink panes and the graph. Filter the graph with `-path:Librarian` if that is noise.

## How it works

### Index

The vault is walked once per run (in `serve`, at most every two seconds, on the next tool call). Each `.md` file is parsed for:

- YAML frontmatter: `title`, `aliases`/`alias`, `tags`/`tag`, `created`/`date`, `modified`/`updated`.
- Inline `#tags`, nested ones included. A parent tag matches its children: `cycles` finds `cycles/debt`.
- `[[wikilinks]]` with `|alias`, `#heading` and `^block` parts, `![[embeds]]`, and Markdown links to other files. Fenced code, inline code and `%%comments%%` are ignored throughout.
- Headings, block ids, open tasks.

**Dates**: created is frontmatter, else the date in a daily note's file name, else the file's birth time; modified is frontmatter, else the file's modification time.

**Link resolution** follows Obsidian: a bare name matches a note's file name without regard to case; when several notes share the name, the one in the linking note's folder wins, then the shortest path. A link with a path is tried as written, relative to the linking note, then as a path suffix. One extension: a name that matches no file but matches exactly a note's alias or frontmatter title resolves to that note (reported as `via: alias`); Obsidian itself would show that link as unresolved. Links whose heading or block does not exist are counted as broken anchors.

Parsed notes are cached by path, modification time and size, so a re-run only parses what changed. A 3,000-note test vault takes about 0.7 s to parse cold and 0.1 s from cache.

### Similarity

No embeddings, no outside service. Three signals, each between 0 and 1:

- **text**: cosine of TF-IDF vectors over each note's prose (frontmatter and code removed, link text kept). `tf = 1 + ln(count)`, `idf = ln(1 + (N - df + 0.5) / (df + 0.5))` (the BM25 form, which is near zero for words in every note). Title and alias words count three times.
- **tags**: weighted Jaccard of the two tag sets, parents included, each tag weighted `ln(1 + N / df)` so a rare shared tag counts for more than `#idea`.
- **neighbours**: weighted Jaccard of the two notes' link neighbourhoods (links in either direction, so it covers both being cited together and citing the same notes), each neighbour weighted `1 / ln(1 + degree)` so an index note counts for little, then multiplied by `n / (n + 1)` for `n` shared neighbours so a single shared neighbour cannot score high.

`score = 0.7 text + 0.15 tags + 0.15 neighbours` (weights configurable). The components are always reported next to the score. A pair only counts as related if `text >= 0.06`, or tags and neighbours are both at least 0.3; shared tags alone, or one shared index note, never make a suggestion.

**Tokenising**: words are lower-cased and stripped of diacritics, so `İstanbul`, `Istanbul` and `istanbul` meet and `dongu` typed on an English keyboard finds `döngü`. Apostrophe suffixes are dropped (`Minsky'nin` becomes `minsky`). There are stop lists for English and Turkish.

**Stemming**: English plurals only (the "S" stemmer: `cycles` to `cycle`, `economies` to `economy`). A full stemmer such as Porter merges too much for notes this short (`desire`, `desirable`, `desired`; `general`, `generate`), and here a false merge costs more than a missed one because every match is shown to you as a reason. Turkish is not stemmed at all: it is agglutinative, a suffix stripper without a dictionary does more harm than good, and a real morphological analyser is a large dependency. The cost is that `borç`, `borcun` and `borçlar` are three different terms, so Turkish notes match each other a little less than English ones do.

### Weekly report

1. Candidates: every pair with `score >= 0.12` that is not linked in either direction, where both notes have at least 30 words and neither is a daily note.
2. At least one side must be old: not modified for 90 days.
3. If anything was created or modified in the last 7 days, pairs of one old note and one touched note come first, best score first. The remaining places up to the limit (10) are filled from the archive: pairs in which neither note was touched. If nothing was touched, all pairs come from the archive.
4. No note appears in more than two pairs.
5. Dismissed pairs are left out. Pairs that a *saved* report showed in an earlier week are held back for six weeks, so the report does not repeat itself; a re-run within the same week gives the same report.

For each pair the report quotes the passage of each note that best matches the other note (TF-IDF cosine between the passage and the other note; passages are paragraphs and single list items, with at least five content words outside links).

- **Orphans worth rescuing**: notes with text and no links in or out, with the one or two notes they are closest to.
- **Notes waiting to be written**: link targets that do not exist and are linked from two or more notes.
- **Mentioned but not linked**: a note's title or alias appearing as whole words (case and diacritics ignored) in a note that does not link to it. Single-word names shorter than six letters, names made only of stop words, names shared by several notes, and daily notes as targets are skipped.

The report is a pure function of the vault, the state file and the date; the ids (`p-…`, `o-…`, `u-…`, `m-…`) are hashes of the paths involved, so they are stable from week to week.

### Source packs

A topic is seed tags, seed notes, key terms and optionally sub-themes. For each note:

```
relevance = 0.4 * tag + 0.3 * graph + 0.3 * text      (re-weighted over the signals the topic has)
tag    1 if the note carries a seed tag or a tag nested under one
graph  1 for a seed note, 0.6 one link away, 0.25 two links away (not walking through daily notes or hubs)
text   cosine of the note with the key terms, divided by the best such cosine in the vault
```

Notes with relevance of at least 0.15 are sources, the best 25 are kept, and each gets a "why included" line listing the signals that fired. A free query uses its words as key terms and any `#tags` in it as seed tags.

**Excerpts**: up to three passages per source, ranked against the key terms, shown in reading order, with the heading they sit under and their line numbers. If no passage holds a key term, a passage under a heading that names the topic or one that links to a core note is used; failing that, the opening paragraph, labelled as such. Passages longer than 700 characters are cut at a sentence end and marked ` […]`. Notes that are only lists of links (fewer than 12 content words outside links) are listed under "Maps and indexes" and not quoted.

**Grouping**, in this order, each group saying why it exists:

1. Sub-themes defined in the topic: a note joins the one it matches best (a matching tag counts 2, a term 1, a term used three times or more 1.5), provided the score is at least 2 and at least 1 ahead of the next sub-theme. Otherwise it goes to "Across sub-themes".
2. With no sub-themes: the tag shared by the most sources (seed and question tags excluded), repeatedly; then a distinctive term shared by at least two of what is left; then "Other".

**Open questions**: missing notes the sources link to, notes carrying a question tag, unchecked `- [ ]` tasks in the sources, and sentences ending in a question mark, all quoted as written.

**New since the last pack**: when a pack is saved, the state file records its sources and their modified dates. The next pack on a later day lists sources that are new, sources modified since, and sources that dropped out.

## Configuring

Everything has a default; the file is optional. Put `vault-librarian.config.json` in the vault root (it is not indexed). `vault-librarian.config.example.json` in this folder lists every field with its default; the fixture vault under `test/fixtures/vault` has a small working one. Unknown fields are rejected with the field name, so a typo does not silently do nothing.

| Field | Default | Meaning |
|---|---|---|
| `outputFolder` | `"Librarian"` | Folder inside the vault for reports and the state file. Must be inside the vault and not a dot-folder. |
| `cacheDir` | `null` | Where the index cache goes. `null` means `$XDG_CACHE_HOME/vault-librarian` or `~/.cache/vault-librarian`. |
| `ignore` | `[]` | Globs for files and folders to leave out. `*` within a name, `**` across folders, `?` one character. A pattern without `/` matches at any depth. |
| `dailyNotesFolder` | `"Daily"` | Notes here (and any note named `YYYY-MM-DD`) are daily notes: dated by file name, left out of pair suggestions, still searched, quoted in packs and scanned for mentions. `null` for none. |
| `questionTags` | `["question","todo","open-question"]` | Tags that mark a note as an open question in packs. |
| `similarity.textWeight` / `tagWeight` / `neighbourWeight` | `0.7` / `0.15` / `0.15` | Weights of the three signals; normalised to sum to 1. |
| `weekly.oldAfterDays` | `90` | Days without modification before a note is old. |
| `weekly.windowDays` | `7` | Length of "this week", ending today. |
| `weekly.limit` | `10` | Pairs per report. |
| `weekly.minScore` | `0.12` | Lowest score a pair may have. |
| `weekly.maxPerNote` | `2` | Most pairs one note may appear in. |
| `weekly.repeatAfterWeeks` | `6` | Weeks before a pair shown in a saved report may be shown again. `0` to always repeat. |
| `weekly.includeDailyNotes` | `false` | Let daily notes take part in pair suggestions. |
| `weekly.minWords` | `30` | Shortest note that can be in a pair or be an orphan worth rescuing. |
| `weekly.unresolvedMinSources` | `2` | Notes that must link to a missing note before it is listed. |
| `weekly.orphanLimit`, `weekly.mentionLimit` | `5`, `10` | Rows in those two sections. |
| `packs.maxSources` | `25` | Sources per pack. |
| `packs.excerptsPerSource` | `3` | Passages quoted per source. |
| `packs.maxExcerptChars` | `700` | Longest quote before it is cut and marked. |
| `packs.minRelevance` | `0.15` | Lowest relevance a source may have. |
| `topics.<name>` | built-in `desire`, `cycles` | `title`, `description`, `seedTags`, `seedNotes` (note names or paths), `keyTerms`, `subThemes` (each `name`, `tags`, `terms`). A topic in the file replaces the built-in one of the same name. |
| `vault` | none | Only read from a file passed with `--config`: the vault path, relative to that file. |

The built-in `desire` and `cycles` topics have seed tags (`#desire`, `#cycles`) and key terms in English and Turkish but **no seed notes**, since those depend on your vault. They work on tags and text alone; add `seedNotes` (two or three central notes per essay) to bring in notes that are linked from them but not tagged. `vault-librarian topics` and the `vault_get_topic` tool show what is in force and which seed notes were not found.

## Known limits

- It has only been run against the fictional fixture vault in `test/fixtures/vault` and a generated 3,000-note vault for speed. The thresholds (`minScore`, the 0.06 text floor, pack relevance) were tuned on the fixture and will probably want adjusting on a real vault; all but the text floor are in the config.
- Text similarity does not cross languages. A Turkish note and an English note on the same idea meet only through tags and shared links.
- TF-IDF matches words, not meaning: two notes on one idea in different vocabulary will not pair, and two notes that share a rare word for unrelated reasons may. That is why every suggestion shows its shared terms and passages.
- Modified dates fall back to file times, which sync tools and git checkouts can reset. If many old notes suddenly look new, add `modified` to frontmatter or check what touched the files.
- A link by alias resolves here but not in Obsidian (see above).
- Obsidian features not parsed: Dataview queries and inline fields, canvas files (treated as attachments), tags or links produced by plugins at render time, footnotes as passages of their own.
- The claude and launchd snippets above follow the documented syntax but were not run in the sandbox this was built in.
- `serve` re-walks the vault on a tool call at most every two seconds. A very large vault pays that walk (about 0.1 s per 3,000 notes when nothing changed) on each call.
- The state file is plain JSON in the vault; if two machines write reports before syncing, the sync tool decides which copy wins.

## Layout

```
src/dates.ts       ISO weeks and date arithmetic on 'YYYY-MM-DD' strings
src/text.ts        folding, stop lists, the S stemmer, tokens with offsets
src/parse.ts       note parser: frontmatter, tags, links, headings, passages
src/paths.ts       path checks, safe file names, atomic writes, globs
src/config.ts      config schema (zod), defaults, the two built-in topics
src/indexer.ts     walk, cache, link resolution, the graph
src/similarity.ts  TF-IDF model, pair scores, passage scoring
src/search.ts      ranked search with filters
src/weekly.ts      weekly report: generate and render
src/pack.ts        source pack: select, excerpt, group, render
src/state.ts       dismissals and history
src/quote.ts       excerpts and blockquotes
src/librarian.ts   ties the above together; the only place that writes
src/server.ts      MCP tools and prompts
src/cli.ts         the vault-librarian command
test/              vitest suites and the fixture vault
evals/             ten questions with checked answers for testing a model against the fixture vault
```

Built on `@modelcontextprotocol/server` 2.x (the current line of the official TypeScript SDK; `@modelcontextprotocol/sdk` 1.x is the earlier line, now in maintenance), `zod` 4 and `yaml`. The core (`parse`, `similarity`, `weekly`, `pack`, `search`) is pure: it takes the index, the state and `today` and touches no files or clocks.
