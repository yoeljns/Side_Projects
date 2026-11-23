/** One colour per tournament seat, shared by the page and the video. */
export const PLAYER_COLORS = [
  '#f2b84b', '#5fd0a5', '#ef6f6c', '#6ea8fe', '#c58af9', '#ff9f68',
  '#4dd4e0', '#f582ae', '#a3d65c', '#9aa5ff', '#d9c27a', '#7fb8a4',
];
export const colorOf = (index: number): string => PLAYER_COLORS[index % PLAYER_COLORS.length];

export const fmt = (x: number): string => {
  const r = Math.abs(x) < 100 && !Number.isInteger(x) ? Math.round(x * 10) / 10 : Math.round(x);
  return (Object.is(r, -0) ? 0 : r).toLocaleString('en-US');
};
