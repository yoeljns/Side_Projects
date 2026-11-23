import type { Question } from './types';

/** A neutral starting set. The owner replaces these with their own under Questions. */
export const DEFAULT_QUESTIONS: Question[] = [
  { id: 'q-where', text: 'Where was I this year?', sections: ['trips'] },
  { id: 'q-built', text: 'What did I build?', sections: ['builds', 'hours'] },
  { id: 'q-learned', text: 'What did I learn?', sections: ['books', 'games'] },
  { id: 'q-wrong', text: 'What did I get wrong?', sections: ['decisions'] },
  { id: 'q-with', text: 'Who did I spend it with?', sections: ['matches'] },
  { id: 'q-next', text: 'What do I want next year?', sections: [] },
];

/** Move the item at `from` to `to`, clamped to the list. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(list.length - 1, to)), 0, item);
  return next;
}

export const wordCount = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);
