import { ZONES, ZONE_LABEL } from '../lib/court';
import { fmtSec, pct } from '../lib/format';
import type { RallySummary } from '../lib/hits';
import type { Insight } from '../lib/insights';
import type { TeamStats } from '../lib/stats';
import type { SavedPlayer } from '../lib/store';
import { SLOT_NAME, slotTeam } from '../lib/tracker';
import { RallyHistogram, RallyTimeline, StackBars } from './Charts';
import { HeatLegend, Heatmap } from './Heatmap';

export const playerLabel = (slot: number, me: number | null): string =>
  `${SLOT_NAME[slot]}${slot === me ? ' · you' : ''}`;
const kmh = (ms: number): string => `${(ms * 3.6).toFixed(1)} km/h`;

export function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {note && <span className="tile-note">{note}</span>}
    </div>
  );
}

const ZONE_KEYS = ZONES.map((z) => ({ key: z, label: ZONE_LABEL[z] }));
const TEAM_KEYS = [
  { key: 'net', label: 'Both at the net' },
  { key: 'mid', label: 'One up, one back' },
  { key: 'back', label: 'Both back' },
];

/** Everything computed for a match. Shared by fresh results and saved matches. */
export function StatsView({
  players,
  teams,
  rallies,
  insights,
  me,
  inPlayOnly,
  totalSec,
  playhead,
  onSeek,
}: {
  players: SavedPlayer[];
  teams: { near: TeamStats; far: TeamStats } | null;
  rallies: RallySummary | null;
  insights: Insight[];
  me: number | null;
  inPlayOnly: boolean;
  totalSec: number;
  playhead?: number | null;
  onSeek?: (t: number) => void;
}) {
  const mine = me === null ? null : players.find((p) => p.slot === me);
  const pairName = (team: 'near' | 'far') => {
    const mineTeam = me !== null && slotTeam(me) === team;
    return mineTeam ? 'Your pair' : me !== null ? 'Opponents' : team === 'near' ? 'A + B' : 'C + D';
  };
  return (
    <>
      {mine && mine.seenSec > 0 && (
        <section>
          <h2>You</h2>
          <div className="tiles">
            <Tile label="Time at the net" value={pct(mine.zonePct.net)} note={`${pct(mine.zonePct.back)} at the back`} />
            <Tile label="Net approaches" value={String(mine.netApproaches)} note={`avg ${mine.avgNetDist.toFixed(1)} m from the net`} />
            <Tile label="Distance covered" value={mine.distanceM >= 1000 ? `${(mine.distanceM / 1000).toFixed(2)} km` : `${Math.round(mine.distanceM)} m`} note={`${(mine.avgSpeed * 60).toFixed(0)} m per minute`} />
            <Tile label="Top speed" value={kmh(mine.topSpeed)} note="sustained" />
            <Tile label="Court side" value={`${pct(Math.max(mine.leftPct, 1 - mine.leftPct))} ${mine.leftPct >= 0.5 ? 'left' : 'right'}`} note={`tracked ${fmtSec(mine.seenSec)}`} />
          </div>
        </section>
      )}

      {insights.length > 0 && (
        <section>
          <h2>What stands out</h2>
          <ul className="insights">
            {insights.map((x, i) => (
              <li key={i} className="card">
                <strong>{x.title}</strong>
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Rallies</h2>
        {rallies && rallies.count > 0 ? (
          <>
            <div className="tiles">
              <Tile label="Rallies" value={String(rallies.count)} note={`ball in play ${pct(rallies.playPct)} of the time`} />
              <Tile label="Average length" value={fmtSec(rallies.avgSec)} note={`median ${fmtSec(rallies.medianSec)}`} />
              <Tile label="Longest" value={fmtSec(rallies.longestSec)} />
              <Tile label="Hits per rally" value={`≈ ${rallies.avgHits.toFixed(1)}`} note="includes loud wall bounces" />
              <Tile label="Rest between rallies" value={fmtSec(rallies.avgRestSec)} note="average" />
            </div>
            <div className="card">
              <h3>Match timeline</h3>
              <RallyTimeline list={rallies.list} totalSec={totalSec} playhead={playhead} onSeek={onSeek} />
            </div>
            <div className="card">
              <h3>Rally length</h3>
              <RallyHistogram buckets={rallies.buckets} />
            </div>
          </>
        ) : (
          <p className="muted">
            {rallies ? 'No rallies were found in the audio. Try raising the hit sensitivity.' : 'No audio was captured, so rallies could not be counted.'}
          </p>
        )}
      </section>

      <section>
        <h2>Positions</h2>
        <p className="muted">
          Top-down view, far end at the top, camera at the bottom. {inPlayOnly ? 'Counting time during rallies only.' : 'Counting the whole video.'}
        </p>
        <div className="heat-grid">
          {players.map((p) => (
            <figure key={p.slot} className={p.slot === me ? 'me' : undefined}>
              <figcaption>
                <strong>{playerLabel(p.slot, me)}</strong>
                <span>{slotTeam(p.slot) === 'near' ? 'near side' : 'far side'}</span>
              </figcaption>
              <Heatmap heat={p.heat} label={`Position heatmap for player ${SLOT_NAME[p.slot]}`} />
            </figure>
          ))}
        </div>
        <HeatLegend />
        <div className="card">
          <h3>Where each player spent their time</h3>
          <StackBars
            keys={ZONE_KEYS}
            rows={players.map((p) => ({
              label: playerLabel(p.slot, me),
              values: ZONES.map((z) => p.zonePct[z]),
              empty: p.seenSec <= 0,
              right: pct(p.zonePct.net),
            }))}
            note="The number on the right is the share of time at the net (within 4 m)."
          />
        </div>
        {teams && (
          <div className="card">
            <h3>How each pair moved together</h3>
            <StackBars
              keys={TEAM_KEYS}
              rows={(['near', 'far'] as const).map((t) => ({
                label: pairName(t),
                values: [teams[t].bothNetPct, teams[t].splitPct, teams[t].bothBackPct],
                empty: teams[t].bothSec < 5,
                right: `${teams[t].gapM.toFixed(1)} m`,
              }))}
              note="The number on the right is the average distance between the two partners."
            />
          </div>
        )}
        <div className="card tablewrap">
          <table>
            <thead>
              <tr>
                <th>Player</th><th className="num">Tracked</th><th className="num">Net</th><th className="num">Approaches</th>
                <th className="num">Distance</th><th className="num">Top speed</th><th className="num">Left side</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.slot} className="static">
                  <td>{playerLabel(p.slot, me)}</td>
                  {p.seenSec > 0 ? (
                    <>
                      <td className="num">{fmtSec(p.seenSec)}</td>
                      <td className="num">{pct(p.zonePct.net)}</td>
                      <td className="num">{p.netApproaches}</td>
                      <td className="num">{Math.round(p.distanceM)} m</td>
                      <td className="num">{kmh(p.topSpeed)}</td>
                      <td className="num">{pct(p.leftPct)}</td>
                    </>
                  ) : (
                    <td className="num" colSpan={6}>not tracked</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
