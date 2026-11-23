import { describe, expect, it } from 'vitest';
import { maskCode, parseNote, passages, sectionRange, splitFrontmatter } from '../src/parse.js';

const NOTE = `---
title: A Title
aliases: [first alias, "second, alias"]
tags: [Desire/Mimetic, theory]
created: 2023-04-11
updated: 2024-02-18T09:30:00
---
# Heading one

Para with [[Target Note]], [[Folder/Other|shown text]], [[Third#Section One]] and [[Fourth#^blk-1|a block]].
Same-note link [[#Heading two]] and an embed ![[image.png]] and ![[Embedded note#Part]].

## Heading two ##

A [markdown link](../Cycles/Kondratiev%20waves.md#Status) and [external](https://example.org/a#b) and <https://example.org>.
An image ![alt](pics/chart.png "title") and a mail [me](mailto:someone@example.org).
Inline #tag-one and #nested/tag/deep, not#this, not #123, colour in \`#fff\`. ^para-id

\`\`\`js
const x = "[[Not A Link]] #not-a-tag";
\`\`\`

- [ ] an open task with [[Task Link]]
- [x] a done task
* [ ] another open task
`;

describe('parseNote', () => {
  const n = parseNote(NOTE);

  it('reads frontmatter: title, aliases, tags, dates', () => {
    expect(n.frontmatterTitle).toBe('A Title');
    expect(n.aliases).toEqual(['first alias', 'second, alias']);
    expect(n.frontmatterCreated).toBe('2023-04-11');
    expect(n.frontmatterModified).toBe('2024-02-18');
    expect(n.frontmatterError).toBeNull();
    expect(n.bodyStartLine).toBe(7);
  });

  it('collects frontmatter and inline tags, lower-cased, and nothing from code or links', () => {
    expect(n.tags).toEqual(['desire/mimetic', 'nested/tag/deep', 'tag-one', 'theory']);
  });

  it('parses wikilinks with alias, heading and block parts, and embeds', () => {
    const wiki = n.links.filter((l) => l.kind === 'wikilink').map((l) => [l.target, l.subpath, l.alias, l.embed, l.line]);
    expect(wiki).toEqual([
      ['Target Note', null, null, false, 10],
      ['Folder/Other', null, 'shown text', false, 10],
      ['Third', 'Section One', null, false, 10],
      ['Fourth', '^blk-1', 'a block', false, 10],
      ['', 'Heading two', null, false, 11],
      ['image.png', null, null, true, 11],
      ['Embedded note', 'Part', null, true, 11],
      ['Task Link', null, null, false, 23],
    ]);
  });

  it('parses markdown links to files and leaves external ones out', () => {
    const md = n.links.filter((l) => l.kind === 'markdown').map((l) => [l.target, l.subpath, l.alias, l.embed]);
    expect(md).toEqual([
      ['../Cycles/Kondratiev waves.md', 'Status', 'markdown link', false],
      ['pics/chart.png', null, 'alt', true],
    ]);
  });

  it('finds headings, block ids and open tasks with file line numbers', () => {
    expect(n.headings).toEqual([
      { level: 1, text: 'Heading one', line: 8 },
      { level: 2, text: 'Heading two', line: 13 },
    ]);
    expect(n.blockIds).toEqual(['para-id']);
    expect(n.tasks).toEqual([
      { text: 'an open task with [[Task Link]]', line: 23 },
      { text: 'another open task', line: 25 },
    ]);
  });

  it('builds prose for similarity without code, link syntax or tags', () => {
    expect(n.plainText).toContain('Para with Target Note, shown text, Third and a block.');
    expect(n.plainText).not.toMatch(/Not A Link|not-a-tag|const x|\[\[|tag-one|example\.org|para-id|image\.png/);
    expect(n.plainText).toContain('markdown link');
  });

  it('handles the awkward notes: empty, code only, no frontmatter, broken YAML, CRLF', () => {
    const empty = parseNote('');
    expect([empty.wordCount, empty.links.length, empty.tags.length, empty.body]).toEqual([0, 0, 0, '']);

    const code = parseNote('```regex\n\\[\\[([^\\]|#]+)   # e.g. [[Not a real link]]\n#not-a-tag\n```\n');
    expect([code.wordCount, code.links.length, code.tags.length]).toEqual([0, 0, 0]);
    expect(passages(code.body)).toEqual([]);

    const unclosed = parseNote('Before\n\n```\n[[Hidden]] to the end of the file');
    expect(unclosed.links).toEqual([]);
    expect(unclosed.plainText).toBe('Before');

    const bad = parseNote('---\ntags: [unclosed\n---\nBody #real');
    expect(bad.frontmatterError).not.toBeNull();
    expect(bad.tags).toEqual(['real']);
    expect(bad.body).toBe('Body #real');

    const noEnd = parseNote('---\nnot frontmatter, just a rule\n\nText');
    expect(noEnd.bodyStartLine).toBe(0);

    const crlf = parseNote('---\r\ntags: a\r\n---\r\n# H\r\n\r\nText [[X]]\r\n');
    expect(crlf.tags).toEqual(['a']);
    expect(crlf.headings[0]).toEqual({ level: 1, text: 'H', line: 4 });
    expect(crlf.links[0].target).toBe('X');
  });

  it('reads tags given as a string or with hashes, and a single alias', () => {
    const a = parseNote('---\ntags: "#one, two three"\nalias: Solo\ndate: 2024-01-02\n---\n');
    expect(a.tags).toEqual(['one', 'three', 'two']);
    expect(a.aliases).toEqual(['Solo']);
    expect(a.frontmatterCreated).toBe('2024-01-02');
  });

  it('lower-cases Turkish tags the Turkish way', () => {
    expect(parseNote('#Türkçe #IŞIK #İstanbul #Ideas').tags).toEqual(['ideas', 'istanbul', 'türkçe', 'ışık']);
  });
});

describe('maskCode and splitFrontmatter', () => {
  it('keeps length and line breaks so offsets still point into the note', () => {
    const body = 'a `code [[x]]` b\n```\n[[y]]\n```\n%% hidden [[z]] %% end';
    const masked = maskCode(body);
    expect(masked.length).toBe(body.length);
    expect(masked.split('\n').length).toBe(body.split('\n').length);
    expect(masked).not.toMatch(/\[\[/);
    expect(masked.startsWith('a ')).toBe(true);
    expect(masked.endsWith(' end')).toBe(true);
  });

  it('only treats a block at the very top as frontmatter', () => {
    expect(splitFrontmatter('text\n---\na: 1\n---\n').yaml).toBeNull();
    expect(splitFrontmatter('---\na: 1\n---\nbody')).toEqual({ yaml: 'a: 1', body: 'body', bodyStartLine: 3 });
  });
});

describe('passages', () => {
  const body = ['# Title', '', 'Opening paragraph', 'on two lines.', '', '## Part', '', '- item one', '  - child of one', '- item two', '', '> a quote', '', '| a | b |', '', '```', 'code', '```', '', '### Deep', 'Last block. ^last'].join('\n');
  const ps = passages(body, 3);

  it('returns blocks verbatim with heading context and file line numbers; list items one by one', () => {
    expect(ps.map((p) => [p.kind, p.text, p.headingPath.join(' > '), p.startLine, p.endLine])).toEqual([
      ['paragraph', 'Opening paragraph\non two lines.', 'Title', 6, 7],
      ['list', '- item one\n  - child of one', 'Title > Part', 11, 12],
      ['list', '- item two', 'Title > Part', 13, 13],
      ['quote', '> a quote', 'Title > Part', 15, 15],
      ['table', '| a | b |', 'Title > Part', 17, 17],
      ['paragraph', 'Last block. ^last', 'Title > Part > Deep', 24, 24],
    ]);
    expect(ps[5].blockId).toBe('last');
    for (const p of ps) expect(body).toContain(p.text);
  });

  it('finds a heading section up to the next heading of the same or a higher level', () => {
    const headings = parseNote(body).headings;
    expect(sectionRange(headings, 'part', 21)).toEqual({ start: 6, end: 21 });
    expect(sectionRange(headings, '## Deep', 21)).toEqual({ start: 20, end: 21 });
    expect(sectionRange(headings, 'Missing', 21)).toBeNull();
  });
});
