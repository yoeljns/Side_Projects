// Browser-side export helpers: file download and turning the live timeline SVG
// into a standalone file.

export function download(filename: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Serialise the timeline as it is on screen. The live SVG paints with CSS
 * variables; a saved file has no stylesheet, so each var(--x) is replaced by
 * its current value. The file therefore keeps the theme (light or dark) it
 * was exported in. The crosshair and invisible hit areas are left out.
 */
export function standaloneSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-noexport]').forEach((n) => n.remove());
  clone.querySelectorAll('[fill-opacity="0"], [stroke-opacity="0"]').forEach((n) => n.remove());
  clone.removeAttribute('class');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const css = getComputedStyle(document.documentElement);
  const text = new XMLSerializer().serializeToString(clone);
  return text.replace(/var\(--([\w-]+)\)/g, (_, name: string) => css.getPropertyValue(`--${name}`).trim() || '#888');
}
