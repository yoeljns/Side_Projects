import { describe, expect, it } from 'vitest';
import { clampView, fitText, packRows, pan, ticks, xToYear, yScale, yearToX, zoomAround, type Limits } from './scale';

const L: Limits = { min: 1750, max: 2050, minSpan: 5 };

describe('year and pixel mapping', () => {
  const v = { start: 1900, end: 2000 };
  it('maps both ways', () => {
    expect(yearToX(v, 800, 1900)).toBe(0);
    expect(yearToX(v, 800, 1950)).toBe(400);
    expect(yearToX(v, 800, 2025)).toBe(1000);
    expect(xToYear(v, 800, 200)).toBe(1925);
    expect(xToYear(v, 800, yearToX(v, 800, 1973))).toBeCloseTo(1973, 9);
  });
});

describe('zoomAround', () => {
  it('keeps the year under the cursor where it was', () => {
    const v = { start: 1900, end: 2000 };
    const z = zoomAround(v, 1925, 0.5, L);
    expect(z).toEqual({ start: 1912.5, end: 1962.5 });
    // 1925 was a quarter of the way across and still is
    expect((1925 - z.start) / (z.end - z.start)).toBeCloseTo(0.25, 9);
  });
  it('will not zoom in past the minimum span or out past the limits', () => {
    const v = { start: 1900, end: 1908 };
    const z = zoomAround(v, 1904, 0.1, L);
    expect(z.end - z.start).toBe(5);
    expect((1904 - z.start) / 5).toBeCloseTo(0.5, 9);
    expect(zoomAround({ start: 1800, end: 2000 }, 1900, 10, L)).toEqual({ start: 1750, end: 2050 });
  });
  it('slides the view back inside the limits when zooming out near an edge', () => {
    // span 100 -> 200 around 1760 (10% across) would start at 1740: pushed to 1750
    expect(zoomAround({ start: 1750, end: 1850 }, 1760, 2, L)).toEqual({ start: 1750, end: 1950 });
  });
});

describe('pan and clamp', () => {
  it('pans by years and stops at the limits without changing the span', () => {
    expect(pan({ start: 1900, end: 2000 }, 20, L)).toEqual({ start: 1920, end: 2020 });
    expect(pan({ start: 1900, end: 2000 }, 500, L)).toEqual({ start: 1950, end: 2050 });
    expect(pan({ start: 1900, end: 2000 }, -500, L)).toEqual({ start: 1750, end: 1850 });
  });
  it('clamps an oversized view to the whole range', () => {
    expect(clampView({ start: 1000, end: 3000 }, L)).toEqual({ start: 1750, end: 2050 });
  });
});

describe('ticks', () => {
  it('picks a round step that leaves room between labels', () => {
    // 300 years over 1200px = 4px a year -> 64px needs 16 years -> step 20
    const t = ticks({ start: 1750, end: 2050 }, 1200);
    expect(t.step).toBe(20);
    expect(t.years[0]).toBe(1760);
    expect(t.years[t.years.length - 1]).toBe(2040);
    // 300 years over 360px = 1.2px a year -> needs 53 years -> step 100
    expect(ticks({ start: 1750, end: 2050 }, 360).years).toEqual([1800, 1900, 2000]);
    // 10 years over 1000px -> every year
    expect(ticks({ start: 1970.5, end: 1980.5 }, 1000)).toEqual({ step: 1, years: [1971, 1972, 1973, 1974, 1975, 1976, 1977, 1978, 1979, 1980] });
  });
});

describe('packRows', () => {
  it('uses the first row with room', () => {
    const r = packRows([
      { id: 'a', x1: 0, x2: 100 },
      { id: 'b', x1: 50, x2: 150 },
      { id: 'c', x1: 110, x2: 200 },
      { id: 'd', x1: 120, x2: 130 },
    ]);
    expect(Object.fromEntries(r.rows)).toEqual({ a: 0, b: 1, c: 0, d: 2 });
    expect(r.count).toBe(3);
    expect(packRows([]).count).toBe(0);
  });
  it('respects the gap', () => {
    expect(packRows([{ id: 'a', x1: 0, x2: 100 }, { id: 'b', x1: 103, x2: 150 }], 6).count).toBe(2);
    expect(packRows([{ id: 'a', x1: 0, x2: 100 }, { id: 'b', x1: 106, x2: 150 }], 6).count).toBe(1);
  });
});

describe('fitText', () => {
  it('keeps, cuts or drops a label', () => {
    expect(fitText('Deployment', 200)).toBe('Deployment');
    // 11px * 0.56 = 6.16px a character; 40px holds 6, minus one for the ellipsis
    expect(fitText('Deployment', 40)).toBe('Deplo…');
    expect(fitText('Deployment', 20)).toBe('');
  });
});

describe('yScale', () => {
  it('is linear by default', () => {
    const s = yScale([10, 20, 40], false)!;
    expect([s.min, s.max]).toEqual([10, 40]);
    expect(s.at(10)).toBe(0);
    expect(s.at(25)).toBeCloseTo(0.5, 9);
    expect(s.at(40)).toBe(1);
  });
  it('puts equal ratios at equal distances on a log scale and skips non-positive values', () => {
    const s = yScale([0, -5, 1, 10, 100], true)!;
    expect([s.min, s.max]).toEqual([1, 100]);
    expect(s.at(10)).toBeCloseTo(0.5, 9);
    expect(Number.isNaN(s.at(0))).toBe(true);
    expect(yScale([0, -1], true)).toBeNull();
  });
  it('gives a flat series some room', () => {
    const s = yScale([5, 5], false)!;
    expect([s.min, s.max]).toEqual([4, 6]);
    expect(s.at(5)).toBe(0.5);
    expect(yScale([5], true)).toMatchObject({ min: 2.5, max: 10 });
    expect(yScale([], false)).toBeNull();
  });
});
