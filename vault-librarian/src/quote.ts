// Quoting notes. The librarian never rewrites a note's words: an excerpt is the block as written,
// or its beginning cut at a sentence end and marked.

export const CUT_MARK = ' […]';

/** The text unchanged when it fits; otherwise a prefix ending at a sentence (or word) boundary plus CUT_MARK. */
export function excerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  let cut = -1;
  for (const m of head.matchAll(/[.!?…]["')\]]*(?=\s)/g)) cut = m.index + m[0].length;
  if (cut < maxChars * 0.4) {
    const lineBreak = head.lastIndexOf('\n');
    const space = head.lastIndexOf(' ');
    cut = lineBreak > maxChars * 0.6 ? lineBreak : space > 0 ? space : maxChars;
  }
  return `${head.slice(0, cut).replace(/\s+$/, '')}${CUT_MARK}`;
}

/** A markdown blockquote of the text, line for line. */
export function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

/** Undoes blockquote() and removes the cut mark: what must be found verbatim in the source note. */
export function unquote(quoted: string): string {
  const text = quoted
    .split('\n')
    .map((line) => line.replace(/^> ?/, ''))
    .join('\n');
  return text.endsWith(CUT_MARK) ? text.slice(0, -CUT_MARK.length) : text;
}
