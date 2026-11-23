export const pct = (p: number): string => `${Math.round(p * 100)}%`;
export const score = (x: number): string => x.toFixed(3);
/** Signed points, e.g. +16 pts. */
export const points = (x: number): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))} pts`;
export const signed = (x: number, digits = 2): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(digits)}`;

export function downloadText(filename: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
