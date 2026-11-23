import type { ReactNode } from 'react';
import { parseBlocks, type Inline } from '../lib/markdownish';

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.text;
      case 'bold':
        return <strong key={i}>{inline(n.children)}</strong>;
      case 'italic':
        return <em key={i}>{inline(n.children)}</em>;
      case 'code':
        return <code key={i}>{n.text}</code>;
      case 'link':
        return (
          <a key={i} href={n.href} target="_blank" rel="noreferrer noopener">
            {inline(n.children)}
          </a>
        );
    }
  });
}

/** Renders the small markdown subset used in annotation and note bodies. */
export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className="md">
      {blocks.map((b, i) =>
        b.t === 'p' ? (
          <p key={i}>{inline(b.children)}</p>
        ) : b.t === 'quote' ? (
          <blockquote key={i}>{inline(b.children)}</blockquote>
        ) : (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
