// Plain-language takeaways from the numbers. Rules, not a model: each one
// fires only when the data clearly supports it.
import { pct } from './format';
import type { RallySummary } from './hits';
import type { TeamStats } from './stats';
import type { SavedPlayer } from './store';
import { partnerOf } from './tracker';

export type Insight = { title: string; text: string };

const MIN_SEC = 20; // below this a player's numbers are too thin to comment on

export function buildInsights(input: {
  players: SavedPlayer[];
  me: number | null;
  teams: { near: TeamStats; far: TeamStats } | null;
  rallies: RallySummary | null;
  /** Your average net share over earlier matches, if any. */
  pastNetPct: number | null;
}): Insight[] {
  const { players, me, teams, rallies, pastNetPct } = input;
  const out: Insight[] = [];
  const by = (slot: number) => players.find((p) => p.slot === slot);
  const mine = me === null ? undefined : by(me);
  const ok = (p: SavedPlayer | undefined): p is SavedPlayer => !!p && p.seenSec >= MIN_SEC;

  if (ok(mine) && me !== null) {
    const net = mine.zonePct.net;
    if (net >= 0.45) out.push({ title: 'You own the net', text: `${pct(net)} of your time was within 4 m of the net. That is where most points are won.` });
    else if (net <= 0.2) out.push({ title: 'You played from the back', text: `Only ${pct(net)} of your time was at the net and ${pct(mine.zonePct.back)} at the back. Look for lobs that let you move up.` });
    if (mine.zonePct.mid >= 0.4) out.push({ title: 'A lot of time in no-man\'s land', text: `${pct(mine.zonePct.mid)} of your time was in the transition zone, 4–7 m from the net. It is the hardest place to defend from: commit forward or drop back.` });

    const partner = by(partnerOf(me));
    if (ok(partner)) {
      const diff = net - partner.zonePct.net;
      if (Math.abs(diff) >= 0.12) {
        out.push({
          title: diff > 0 ? 'Your partner hangs back' : 'Your partner is up more than you',
          text: `You were at the net ${pct(net)} of the time, your partner ${pct(partner.zonePct.net)}. Moving up and back together closes the gap between you.`,
        });
      }
    }
    if (pastNetPct !== null && Math.abs(net - pastNetPct) >= 0.05) {
      const up = net > pastNetPct;
      out.push({
        title: up ? 'More net time than usual' : 'Less net time than usual',
        text: `${pct(net)} at the net against your ${pct(pastNetPct)} average over earlier matches.`,
      });
    }
    if (mine.leftPct >= 0.75 || mine.leftPct <= 0.25) {
      out.push({ title: `You held the ${mine.leftPct >= 0.5 ? 'left' : 'right'} side`, text: `${pct(Math.max(mine.leftPct, 1 - mine.leftPct))} of your time was on that half.` });
    }
  }

  if (teams && me !== null) {
    const us = me < 2 ? teams.near : teams.far, them = me < 2 ? teams.far : teams.near;
    if (us.bothSec >= MIN_SEC && them.bothSec >= MIN_SEC && Math.abs(us.bothNetPct - them.bothNetPct) >= 0.08) {
      const ahead = us.bothNetPct > them.bothNetPct;
      out.push({
        title: ahead ? 'Your pair controlled the net' : 'They controlled the net',
        text: `You were both at the net ${pct(us.bothNetPct)} of the time; your opponents ${pct(them.bothNetPct)}.`,
      });
    }
    if (us.bothSec >= MIN_SEC && us.splitPct >= 0.35) {
      out.push({ title: 'Often one up, one back', text: `${pct(us.splitPct)} of the time one of you was at the net and the other was not, which leaves a diagonal gap to attack.` });
    }
  }

  if (rallies && rallies.count >= 8) {
    const short = rallies.buckets[0] / rallies.count;
    const long = (rallies.buckets[3] + rallies.buckets[4]) / rallies.count;
    if (short >= 0.5) out.push({ title: 'Points ended quickly', text: `${pct(short)} of rallies were over within 5 seconds. Serve and return are deciding most points.` });
    else if (long >= 0.2) out.push({ title: 'Long, grinding rallies', text: `${pct(long)} of rallies went past 20 seconds. Patience and fitness mattered in this one.` });
    if (rallies.playPct > 0 && rallies.playPct <= 0.3) out.push({ title: 'Lots of time between points', text: `The ball was in play for ${pct(rallies.playPct)} of the recording, with ${Math.round(rallies.avgRestSec)} s between rallies on average.` });
  }
  return out.slice(0, 6);
}
