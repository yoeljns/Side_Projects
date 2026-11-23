// A small RFC 4180 reader: quoted fields may hold commas, line breaks and doubled quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // byte-order mark
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else field += ch;
  }
  if (field !== '' || row.length > 0) endRow();
  // Blank lines are not rows.
  return rows.filter((r) => r.length > 1 || r[0].trim() !== '');
}

/** Rows as objects keyed by the trimmed header. */
export function csvRecords(text: string): { header: string[]; records: Record<string, string>[] } {
  const [head, ...body] = parseCsv(text);
  if (!head) return { header: [], records: [] };
  const header = head.map((h) => h.trim());
  return { header, records: body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}
