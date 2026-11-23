import { useState, type RefObject } from 'react';
import { markdownSummary } from '../lib/exportMd';
import { REFERENCE_TRACKS } from '../lib/reference';
import type { View } from '../lib/scale';
import type { Store } from '../lib/store';
import type { AtlasDoc, Track } from '../lib/types';
import { download, standaloneSvg } from './exportFiles';
import { SyncPanel } from './SyncPanel';

interface Props {
  store: Store<AtlasDoc>;
  tracks: Track[];
  view: View;
  today: string;
  svgRef: RefObject<SVGSVGElement | null>;
}

export function SettingsPanel({ store, tracks, view, today, svgRef }: Props) {
  const [dropped, setDropped] = useState(true);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(false);
  const range = `${Math.floor(view.start)}-${Math.ceil(view.end)}`;
  const md = () => markdownSummary({ doc: store.state, tracks, view, today, includeDropped: dropped });

  return (
    <>
      <section className="card">
        <h2>Export</h2>
        <p className="note-small">
          The view exports cover what is on the timeline now: <span className="num">{range}</span>, the tracks that are shown, and the annotations that pass the current filter (SVG) or fall in the range (markdown).
        </p>
        <div className="btn-row">
          <button
            className="btn"
            onClick={() => {
              if (!svgRef.current) return;
              download(`cycle-atlas-${range}.svg`, standaloneSvg(svgRef.current), 'image/svg+xml');
              setNote('Saved the view as an SVG in the current colour theme.');
            }}
          >
            View as SVG
          </button>
          <button
            className="btn"
            onClick={() => {
              download(`cycle-atlas-${range}.md`, md(), 'text/markdown');
              setNote('Saved the markdown summary.');
            }}
          >
            Summary as markdown
          </button>
          <button
            className="btn"
            onClick={() => {
              navigator.clipboard.writeText(md()).then(
                () => setNote('Markdown copied. Paste it into your essay notes.'),
                () => {
                  setPreview(true);
                  setNote('Could not reach the clipboard. The text is shown below to copy by hand.');
                },
              );
            }}
          >
            Copy markdown
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={dropped} onChange={(e) => setDropped(e.target.checked)} /> Include dropped ideas in the markdown
        </label>
        <details open={preview} onToggle={(e) => setPreview((e.target as HTMLDetailsElement).open)}>
          <summary>Preview the markdown</summary>
          {preview && <pre className="preview">{md()}</pre>}
        </details>
        <div className="btn-row">
          <button
            className="btn"
            onClick={() => {
              const { tracks: own, trackPrefs, annotations, notes, series } = store.state;
              const out = { app: 'cycle-atlas', exportedOn: today, referenceTracks: REFERENCE_TRACKS, tracks: own, trackPrefs, annotations, notes, series };
              download(`cycle-atlas-full-${today}.json`, JSON.stringify(out, null, 2), 'application/json');
              setNote('Saved the whole atlas as JSON.');
            }}
          >
            Whole atlas as JSON
          </button>
        </div>
        <p className="note-small">The JSON holds your tracks, annotations, notes and series together with the built-in reference set, for use outside this app. To move your work between browsers, use the backup below instead.</p>
        {note && (
          <p className="small" role="status">
            {note}
          </p>
        )}
      </section>
      <SyncPanel store={store} filename="cycle-atlas" />
    </>
  );
}
