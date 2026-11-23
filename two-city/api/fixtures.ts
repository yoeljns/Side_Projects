// Vercel serverless function: fetches Chelsea's league fixtures from
// fixturedownload.com and passes the JSON through with cache headers, so the
// browser is not blocked by CORS and the feed is not hit on every page view.
// GET /api/fixtures?season=2026  (season = the year the season starts)

const season = (url: string): number => {
  const asked = Number(new URL(url).searchParams.get('season'));
  if (Number.isInteger(asked) && asked >= 2015 && asked <= 2100) return asked;
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
};

const json = (body: unknown, status: number, cache: string): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache } });

export async function GET(request: Request): Promise<Response> {
  const year = season(request.url);
  const source = `https://fixturedownload.com/feed/json/epl-${year}/chelsea`;
  try {
    const res = await fetch(source, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return json({ error: `The fixture feed answered ${res.status}.`, source }, 502, 'no-store');
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return json({ error: 'The fixture feed did not return a list.', source }, 502, 'no-store');
    // Fresh for an hour at the edge, then served stale for up to a day while it refetches.
    return json(data, 200, 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  } catch (e) {
    return json({ error: `Could not reach the fixture feed: ${e instanceof Error ? e.message : 'unknown error'}.`, source }, 502, 'no-store');
  }
}
