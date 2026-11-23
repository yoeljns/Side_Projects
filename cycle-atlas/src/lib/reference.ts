// The built-in reference set: published chronologies, one track per author.
//
// These are each author's periodisation, not facts. Authors disagree with one
// another and often give ranges or "approximate" dates themselves. Where the
// source gives a range, where sources differ, or where the date here is a
// reading of the source rather than a number it prints, the item is marked
// `approximate: true` and the note says why. Nothing here is a data series.
//
// Sources
// - Perez, C. (2002), Technological Revolutions and Financial Capital, Edward Elgar:
//   the five big-bangs and the installation / turning point / deployment periods
//   (her figure of approximate dates for each great surge).
// - Kondratiev waves: the dating ranges tabulated in Korotayev, A. and Tsirel, S.
//   (2010), "A spectral analysis of world GDP dynamics", Structure and Dynamics 4(1),
//   which summarises the commonly cited post-Kondratiev dating. Ranges, so every
//   boundary here is a midpoint and approximate.
// - Dalio, R. (2018), Principles for Navigating Big Debt Crises, Bridgewater: the US
//   case studies (1928-1937, 2007-2011) and the long-term debt cycle framing. The
//   phase boundaries are a reading "in the spirit of" that framework, all approximate.
// - Interest rates: Federal Open Market Committee statements for the target range
//   dates; Homer, S. and Sylla, R. (2005), A History of Interest Rates, 4th ed., Wiley,
//   for the secular turning points in long-term US yields.
// - Reinhart, C. and Rogoff, K. (2009), This Time Is Different, Princeton University
//   Press: the five waves of sovereign default and the 2007-09 banking crisis.
//   Decade-level in the source, so the cluster edges are approximate.
// - Erten, B. and Ocampo, J. A. (2013), "Super cycles of commodity prices since the
//   mid-nineteenth century", World Development 44: non-oil real commodity prices.
// - Hamilton, J. (2011), "Historical oil shocks", NBER Working Paper 16790, for the
//   shocks to 2008; later ones are ordinary dated events.
// - Monetary regimes follow the conventional dating in Eichengreen, B. (2008),
//   Globalizing Capital, 2nd ed., Princeton University Press.
import type { CycleEvent, EventKind, Phase, PhaseKind, Track } from './types';

const PEREZ = 'Perez (2002), Technological Revolutions and Financial Capital';
const KT = 'Korotayev and Tsirel (2010), Structure and Dynamics 4(1), table of commonly cited K-wave dates';
const DALIO = 'Dalio (2018), Principles for Navigating Big Debt Crises';
const FOMC = 'Federal Open Market Committee statements';
const HS = 'Homer and Sylla (2005), A History of Interest Rates, 4th ed.';
const RR = 'Reinhart and Rogoff (2009), This Time Is Different';
const EO = 'Erten and Ocampo (2013), World Development 44';
const HAM = 'Hamilton (2011), Historical oil shocks, NBER WP 16790';
const EICH = 'Eichengreen (2008), Globalizing Capital, 2nd ed.';
const GENERAL = 'General chronology';

function ph(
  id: string,
  name: string,
  start: number,
  end: number | null,
  kind: PhaseKind,
  source: string,
  note?: string,
  approximate?: boolean,
): Phase {
  return { id, name, start, end, kind, source, ...(note ? { note } : {}), ...(approximate ? { approximate } : {}) };
}
function ev(
  id: string,
  year: number,
  label: string,
  kind: EventKind,
  source: string,
  note?: string,
  approximate?: boolean,
): CycleEvent {
  return { id, year, label, kind, source, ...(note ? { note } : {}), ...(approximate ? { approximate } : {}) };
}

const PEREZ_APPROX = 'Perez gives these periods as approximate and notes that phases overlap in practice.';

export const REFERENCE_TRACKS: Track[] = [
  {
    id: 'ref-perez',
    name: 'Technological revolutions',
    author: 'Perez',
    group: 'technology',
    color: 0,
    description:
      "Carlota Perez's five great surges of development. Each starts with a big-bang, has an installation period led by financial capital, a turning point after the bubble bursts, and a deployment period led by production capital.",
    phases: [
      ph('pz1i', '1st: installation', 1771, 1793, 'installation', PEREZ, 'The Industrial Revolution. Ends with canal mania in Britain.'),
      ph('pz1t', '1st: turning point', 1793, 1798, 'turning', PEREZ, `Given as 1793-97. ${PEREZ_APPROX}`, true),
      ph('pz1d', '1st: deployment', 1798, 1829, 'deployment', PEREZ, 'Synergy to about 1812, then maturity.'),
      ph('pz2i', '2nd: installation', 1829, 1848, 'installation', PEREZ, 'Age of steam and railways. Ends with the railway mania of the 1840s.'),
      ph('pz2t', '2nd: turning point', 1848, 1850, 'turning', PEREZ, PEREZ_APPROX, true),
      ph('pz2d', '2nd: deployment', 1850, 1873, 'deployment', PEREZ, 'The Victorian boom, then maturity from about 1857.'),
      ph('pz3i', '3rd: installation', 1875, 1893, 'installation', PEREZ, 'Age of steel, electricity and heavy engineering.'),
      ph('pz3t', '3rd: turning point', 1893, 1895, 'turning', PEREZ, PEREZ_APPROX, true),
      ph('pz3d', '3rd: deployment', 1895, 1918, 'deployment', PEREZ, 'Belle Epoque in Europe, Progressive Era in the US; maturity from about 1908, overlapping the next surge.'),
      ph('pz4i', '4th: installation', 1908, 1929, 'installation', PEREZ, 'Age of oil, the automobile and mass production. Overlaps the maturity of the 3rd surge; frenzy in the 1920s.'),
      ph('pz4t', '4th: turning point', 1929, 1943, 'turning', PEREZ, 'Perez gives 1929-33 for Europe and 1929-43 for the US. The US dating is used here.', true),
      ph('pz4d', '4th: deployment', 1943, 1974, 'deployment', PEREZ, 'Post-war golden age, then maturity from about 1960.'),
      ph('pz5i', '5th: installation', 1971, 2001, 'installation', PEREZ, 'Age of information and telecommunications. Overlaps the maturity of the 4th surge; frenzy from about 1987 to the dot-com crash.'),
      ph('pz5t', '5th: turning point', 2001, null, 'turning', PEREZ, 'The 2002 book leaves the end open ("2001-??"). Perez has since argued the turning point has been unusually prolonged; whether deployment has begun is contested. Duplicate the track to place your own date.', true),
    ],
    events: [
      ev('pzb1', 1771, "Big-bang: Arkwright's mill opens at Cromford", 'start', PEREZ),
      ev('pzb2', 1829, "Big-bang: the Rocket wins the Rainhill trials", 'start', PEREZ),
      ev('pzb3', 1875, 'Big-bang: Carnegie Bessemer steel plant opens in Pittsburgh', 'start', PEREZ),
      ev('pzb4', 1908, 'Big-bang: first Model T leaves the Ford plant in Detroit', 'start', PEREZ),
      ev('pzb5', 1971, 'Big-bang: Intel announces the microprocessor', 'start', PEREZ),
    ],
  },
  {
    id: 'ref-kondratiev',
    name: 'Kondratiev waves',
    author: 'Commonly cited dating, after Kondratiev',
    group: 'technology',
    color: 6,
    description:
      'Long waves of roughly 40 to 60 years. There is no agreed dating: the literature gives a range for every turning point and some economists doubt the waves exist. Each boundary here is the middle of the commonly cited range, so every date is approximate.',
    phases: [
      ph('k1u', 'K1 upswing', 1790, 1815, 'expansion', KT, 'Start cited as "the 1780s" to 1790; end 1810-17.', true),
      ph('k1d', 'K1 downswing', 1815, 1848, 'contraction', KT, 'Cited range 1810-17 to 1844-51.', true),
      ph('k2u', 'K2 upswing', 1848, 1873, 'expansion', KT, 'Cited range 1844-51 to 1870-75.', true),
      ph('k2d', 'K2 downswing', 1873, 1893, 'contraction', KT, 'Cited range 1870-75 to 1890-96.', true),
      ph('k3u', 'K3 upswing', 1893, 1917, 'expansion', KT, 'Cited range 1890-96 to 1914-20.', true),
      ph('k3d', 'K3 downswing', 1917, 1945, 'contraction', KT, 'Cited range 1914-20 to 1939-50. Some datings start the downswing only in 1929.', true),
      ph('k4u', 'K4 upswing', 1945, 1971, 'expansion', KT, 'Cited range 1939-50 to 1968-74.', true),
      ph('k4d', 'K4 downswing', 1971, 1988, 'contraction', KT, 'Cited range 1968-74 to 1984-91.', true),
      ph('k5u', 'K5 upswing', 1988, 2008, 'expansion', KT, 'Cited range 1984-91 to 2008-10. The end date is the most disputed.', true),
      ph('k5d', 'K5 downswing', 2008, null, 'contraction', KT, 'Start cited as 2008-10, with a question mark in the source. No end date given.', true),
    ],
    events: [
      ev('kp1', 1815, 'K1 peak', 'peak', KT, 'Range 1810-17.', true),
      ev('kp2', 1873, 'K2 peak', 'peak', KT, 'Range 1870-75.', true),
      ev('kp3', 1917, 'K3 peak', 'peak', KT, 'Range 1914-20.', true),
      ev('kp4', 1971, 'K4 peak', 'peak', KT, 'Range 1968-74.', true),
      ev('kp5', 2008, 'K5 peak', 'peak', KT, 'Range 2008-10, uncertain.', true),
    ],
  },
  {
    id: 'ref-dalio',
    name: 'Long-term debt cycle (US)',
    author: 'In the spirit of Dalio',
    group: 'debt',
    color: 1,
    description:
      "A reading of Ray Dalio's long-term debt cycle for the United States: decades of leveraging, a bubble, a deleveraging, then a new cycle. Dalio describes the mechanism and dates the case studies; the phase edges here are an interpretation, so all are approximate.",
    phases: [
      ph('d1', 'Leveraging: 1920s boom', 1921, 1929, 'expansion', DALIO, 'Dalio dates the bubble itself to about 1927-29. The 1921 start is a convenience, not his.', true),
      ph('d2', 'Depression and deflationary deleveraging', 1929, 1933, 'contraction', DALIO, 'From the 1929 top to the break with gold in 1933.', true),
      ph('d3', 'Reflation, deleveraging and war finance', 1933, 1945, 'trough', DALIO, 'Reflationary deleveraging after 1933, the 1937 tightening, then wartime borrowing with yields pegged.', true),
      ph('d4', 'Post-war leveraging', 1945, 2008, 'expansion', DALIO, 'Dalio dates the current long-term debt cycle and world order from 1945. Debt rose relative to income for six decades, with the 1971 break and the 1980s disinflation inside it.', true),
      ph('d5', 'Deleveraging and monetisation (late cycle)', 2008, null, 'contraction', DALIO, "Dalio's case study runs 2007-11; he treats the years since as the late stage of the cycle that began in 1945. The source gives no end date.", true),
    ],
    events: [
      ev('de1', 1929, 'Debt bubble top and crash', 'peak', DALIO),
      ev('de2', 1933, 'Dollar devalued against gold; bank holiday', 'trough', DALIO),
      ev('de3', 1937, 'Tightening and relapse into recession', 'shock', DALIO),
      ev('de4', 1971, 'Dollar link to gold ended', 'shock', DALIO),
      ev('de5', 2007, 'Debt bubble top', 'peak', DALIO, 'Dalio dates the bubble 2004-07 and the top to late 2007; the depression phase starts in 2008.', true),
      ev('de6', 2008, 'Rates hit zero; quantitative easing begins', 'crisis', DALIO),
    ],
  },
  {
    id: 'ref-rates',
    name: 'US interest-rate regime',
    author: 'Federal Reserve dates; Homer and Sylla',
    group: 'debt',
    color: 3,
    description:
      'Secular swings in US long-term yields and the turning points in the federal funds rate. The policy dates are exact; the secular highs and lows are the conventional ones and the latest is still open to argument.',
    phases: [
      ph('r1', 'Falling yields', 1920, 1946, 'contraction', HS, 'Long-term US yields from the 1920 high to the 1946 low.', true),
      ph('r2', 'Rising yields', 1946, 1981, 'expansion', HS, 'From the 1946 low to the 1981 high.'),
      ph('r3', 'Falling yields', 1981, 2020, 'contraction', HS, 'The 10-year Treasury yield fell from near 16% in 1981 to about 0.5% in 2020. The 2020 end is outside the source, which was published in 2005.', true),
      ph('r4', 'Rising yields', 2020, null, 'expansion', GENERAL, 'Whether 2020 was the secular low is not settled.', true),
    ],
    events: [
      ev('re1', 1951, 'Treasury-Fed Accord ends the yield peg', 'other', GENERAL),
      ev('re2', 1979, 'Volcker shifts to targeting reserves', 'shock', FOMC),
      ev('re3', 1981, 'Fed funds and long yields peak', 'peak', 'Federal Reserve H.15 data; ' + HS, 'Effective fed funds averaged about 19% in mid-1981; the 10-year yield peaked that September.'),
      ev('re4', 2008, 'Fed funds target cut to 0-0.25%', 'trough', FOMC, 'December 2008. First zero bound.'),
      ev('re5', 2015, 'First rise from zero', 'other', FOMC, 'December 2015.'),
      ev('re6', 2020, 'Fed funds target cut to 0-0.25% again', 'trough', FOMC, 'March 2020. Second zero bound.'),
      ev('re7', 2022, 'Tightening begins', 'other', FOMC, 'March 2022.'),
    ],
  },
  {
    id: 'ref-crises',
    name: 'Sovereign default and banking crisis clusters',
    author: 'Reinhart and Rogoff',
    group: 'debt',
    color: 7,
    description:
      'The waves of sovereign default that Reinhart and Rogoff identify, plus the 2007-09 banking crisis. The book describes them by decade, so the edges here are approximate.',
    phases: [
      ph('c1', 'Napoleonic-era defaults', 1800, 1815, 'crisis', RR, 'Described as the Napoleonic Wars; no exact years given.', true),
      ph('c2', 'Defaults of the 1820s to 1840s', 1826, 1848, 'crisis', RR, '"The 1820s through the late 1840s", led by the newly independent Latin American states.', true),
      ph('c3', 'Defaults of the 1870s to 1890s', 1873, 1893, 'crisis', RR, '"The early 1870s" for about two decades.', true),
      ph('c4', 'Great Depression defaults', 1931, 1952, 'crisis', RR, '"The 1930s through the early 1950s".', true),
      ph('c5', 'Emerging-market debt crises', 1982, 1999, 'crisis', RR, 'The 1980s and 1990s, from the Mexican default to the Asian and Russian crises.', true),
      ph('c6', 'Global financial crisis', 2007, 2009, 'crisis', RR, 'A banking crisis cluster rather than a default wave. The book was published in 2009, so the euro-area debt crisis that followed is not in it.'),
    ],
    events: [
      ev('ce1', 1825, 'Panic of 1825', 'crisis', RR),
      ev('ce2', 1873, 'Panic of 1873', 'crisis', RR),
      ev('ce3', 1890, 'Baring crisis', 'crisis', RR),
      ev('ce4', 1907, 'Panic of 1907', 'crisis', RR),
      ev('ce5', 1931, 'Creditanstalt fails; defaults spread', 'crisis', RR),
      ev('ce6', 1982, 'Mexico suspends debt payments', 'crisis', RR),
      ev('ce7', 1997, 'Asian financial crisis', 'crisis', RR),
      ev('ce8', 1998, 'Russia defaults', 'crisis', RR),
      ev('ce9', 2001, 'Argentina defaults', 'crisis', RR),
      ev('ce10', 2008, 'Lehman Brothers fails', 'crisis', RR),
      ev('ce11', 2010, 'Greek debt crisis begins', 'crisis', GENERAL, 'After the book.'),
    ],
  },
  {
    id: 'ref-commodities',
    name: 'Commodity super-cycles (non-oil)',
    author: 'Erten and Ocampo',
    group: 'commodities',
    color: 2,
    description:
      'Four super-cycles in real non-oil commodity prices found with a band-pass filter. Each runs trough to trough with a dated peak. Other papers using other filters and indices get different dates.',
    phases: [
      ph('s1u', '1st super-cycle: upswing', 1894, 1917, 'expansion', EO),
      ph('s1d', '1st super-cycle: downswing', 1917, 1932, 'contraction', EO),
      ph('s2u', '2nd super-cycle: upswing', 1932, 1951, 'expansion', EO),
      ph('s2d', '2nd super-cycle: downswing', 1951, 1971, 'contraction', EO),
      ph('s3u', '3rd super-cycle: upswing', 1971, 1973, 'expansion', EO, 'A very short upswing in the non-oil index: the peak comes two years after the trough.'),
      ph('s3d', '3rd super-cycle: downswing', 1973, 1999, 'contraction', EO),
      ph('s4u', '4th super-cycle: upswing', 1999, 2010, 'expansion', EO, 'The paper calls this cycle ongoing; its data end in 2010, so the 2010 peak is the end of the sample as much as a finding.', true),
      ph('s4d', '4th super-cycle: after the peak', 2010, null, 'contraction', EO, 'Outside the paper. Marked as a downswing only because prices fell after 2011; whether a fifth cycle has begun is open.', true),
    ],
    events: [
      ev('sp1', 1917, 'Peak of 1st super-cycle', 'peak', EO),
      ev('sp2', 1951, 'Peak of 2nd super-cycle', 'peak', EO),
      ev('sp3', 1973, 'Peak of 3rd super-cycle', 'peak', EO),
      ev('sp4', 2010, 'Peak of 4th super-cycle', 'peak', EO, 'End of the sample; provisional.', true),
    ],
  },
  {
    id: 'ref-oil',
    name: 'Oil shocks',
    author: 'Hamilton, and later events',
    group: 'commodities',
    color: 4,
    description: 'Dated disruptions to the oil price. Events only; this is not a cycle.',
    phases: [],
    events: [
      ev('o1', 1956, 'Suez crisis', 'shock', HAM),
      ev('o2', 1973, 'Arab oil embargo', 'shock', HAM, 'October 1973.'),
      ev('o3', 1979, 'Iranian revolution', 'shock', HAM, 'Supply fell from late 1978.'),
      ev('o4', 1980, 'Iran-Iraq war', 'shock', HAM),
      ev('o5', 1986, 'Price collapse', 'trough', GENERAL),
      ev('o6', 1990, 'Iraq invades Kuwait', 'shock', HAM),
      ev('o7', 2008, 'Price spike above $140', 'peak', HAM, 'July 2008.'),
      ev('o8', 2014, 'Price collapse', 'trough', GENERAL),
      ev('o9', 2020, 'Pandemic collapse; US futures briefly negative', 'trough', GENERAL, 'April 2020.'),
      ev('o10', 2022, 'Russia invades Ukraine', 'shock', GENERAL),
    ],
  },
  {
    id: 'ref-context',
    name: 'Monetary regimes and wars',
    author: 'Conventional dating, after Eichengreen',
    group: 'context',
    color: 8,
    description: 'For orientation only: the international monetary regime of the day and the major wars.',
    phases: [
      ph('m1', 'Bank Restriction: sterling inconvertible', 1797, 1821, 'regime', EICH),
      ph('m2', 'Sterling on gold; bimetallism elsewhere', 1821, 1873, 'regime', EICH, 'Britain resumed gold payments in 1821. The end date is the conventional start of the international gold standard.', true),
      ph('m3', 'Classical gold standard', 1873, 1914, 'regime', EICH, 'Conventionally dated from the 1870s: Germany adopted gold in 1871-73 and the US resumed in 1879.', true),
      ph('m4', 'War, suspension and the interwar gold-exchange standard', 1914, 1944, 'regime', EICH, 'Britain returned to gold in 1925 and left in 1931; the US devalued in 1933.'),
      ph('m5', 'Bretton Woods', 1944, 1971, 'regime', EICH, 'From the 1944 conference to the closing of the gold window. Generalised floating followed in 1973.'),
      ph('m6', 'Floating fiat currencies', 1971, null, 'regime', EICH),
    ],
    events: [
      ev('w1', 1789, 'French Revolution', 'other', GENERAL),
      ev('w2', 1815, 'Napoleonic Wars end at Waterloo', 'other', GENERAL),
      ev('w3', 1861, 'American Civil War begins (to 1865)', 'other', GENERAL),
      ev('w4', 1914, 'First World War begins (to 1918)', 'other', GENERAL),
      ev('w5', 1925, 'Britain returns to gold', 'other', EICH),
      ev('w6', 1931, 'Britain leaves gold', 'shock', EICH),
      ev('w7', 1939, 'Second World War begins (to 1945)', 'other', GENERAL),
      ev('w8', 1944, 'Bretton Woods conference', 'start', EICH),
      ev('w9', 1971, 'Nixon closes the gold window', 'shock', EICH),
      ev('w10', 1989, 'Berlin Wall falls', 'other', GENERAL),
      ev('w11', 1999, 'Euro launched', 'other', GENERAL),
      ev('w12', 2020, 'Covid-19 pandemic', 'shock', GENERAL),
    ],
  },
];

export const REFERENCE_IDS = new Set(REFERENCE_TRACKS.map((t) => t.id));
