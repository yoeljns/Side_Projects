// A small subset of markdown for annotation and note bodies: paragraphs,
// "- " lists, "> " quotes, **bold**, *italic*, `code` and [text](https://…) links.
// Parsed to a tree so the UI can render it without ever setting HTML.

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'bold'; children: Inline[] }
  | { t: 'italic'; children: Inline[] }
  | { t: 'code'; text: string }
  | { t: 'link'; href: string; children: Inline[] };

export type Block = { t: 'p'; children: Inline[] } | { t: 'ul'; items: Inline[][] } | { t: 'quote'; children: Inline[] };

const safeHref = (href: string): boolean => /^(https?:\/\/|mailto:)/i.test(href);

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ t: 'code', text: m[1] });
    } else if ((m = /^\*\*([^*]+(?:\*[^*]+)*?)\*\*/.exec(rest))) {
      flush();
      out.push({ t: 'bold', children: parseInline(m[1]) });
    } else if ((m = /^\*([^*\s][^*]*?)\*/.exec(rest))) {
      flush();
      out.push({ t: 'italic', children: parseInline(m[1]) });
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)) && safeHref(m[2])) {
      flush();
      out.push({ t: 'link', href: m[2], children: parseInline(m[1]) });
    } else {
      buf += src[i];
      i += 1;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', children: parseInline(para.join(' ')) });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push({ t: 'ul', items: list });
    list = null;
  };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      endPara();
      endList();
    } else if (/^[-*] /.test(line)) {
      endPara();
      list = [...(list ?? []), parseInline(line.slice(2).trim())];
    } else if (line.startsWith('> ')) {
      endPara();
      endList();
      blocks.push({ t: 'quote', children: parseInline(line.slice(2)) });
    } else {
      endList();
      para.push(line);
    }
  }
  endPara();
  endList();
  return blocks;
}
