import { fmtSec, pct } from '../lib/format';
import type { RallySummary } from '../lib/hits';
import type { SavedPlayer } from '../lib/store';
import { SLOT_NAME, slotTeam } from '../lib/tracker';
import { RallyHistogram, ZoneBars } from './Charts';
import { HeatLegend, Heatmap } from './Heatmap';

export const playerLabel = (slot: number, me: number | null): string =>
  `${SLOT_NAME[slot]}${slot === me ? ' · you' : ''}`;

export function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {note && <span className="tile-note">{note}</span>}
    </div>
  );
}

/** Rallies, heatmaps and zone split. Shared by fresh results and saved matches. */
export function StatsView({
  players,
  rallies,
  me,
  inPlayOnly,
}: {
  players: SavedPlayer[];
  rallies: RallySummary | null;
  me: number | null;
  inPlayOnly: boolean;
}) {
  const mine = me === null ? null : players.find((p) => p.slot === me);
  return (
    <>
      {mine && mine.seenSec > 0 && (
        <section>
          <h2>You</h2>
          <div className="tiles">
            <Tile label="Time at the net" value={pct(mine.zonePct.net)} note={`${pct(mine.zonePct.back)} at the back`} />
            <Tile label="Distance covered" value={`${(mine.distanceM / 1000).toFixed(2)} km`} note="estimate" />
            <Tile label="Tracked" value={fmtSec(mine.seenSec)} note={inPlayOnly ? 'during rallies' : 'whole video'} />
          </div>
        </section>
      )}

      <section>
        <h2>Rallies</h2>
        {rallies && rallies.count > 0 ? (
          <>
            <div className="tiles">
              <Tile label="Rallies" value={String(rallies.count)} />
              <Tile label="Average length" value={fmtSec(rallies.avgSec)} note={`median ${fmtSec(rallies.medianSec)}`} />
              <Tile label="Longest" value={fmtSec(rallies.longestSec)} />
              <Tile label="Hits per rally" value={`≈ ${rallies.avgHits.toFixed(1)}`} note="includes loud wall bounces" />
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
          <ZoneBars
            rows={players.map((p) => ({ label: playerLabel(p.slot, me), zonePct: p.zonePct, empty: p.seenSec <= 0 }))}
          />
        </div>
      </section>
    </>
  );
}
