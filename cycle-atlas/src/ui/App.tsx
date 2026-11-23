import { useMemo, useRef, useState } from 'react';
import { allTracks, blankAnnotation, decimalYear, deleteAnnotation, duplicateTrack, filterAnnotations, annotationYears, findTrack, isBuiltin, redatePhase, setStatus, updateTrack, upsertAnnotation, visibleTracks, yearOf, type AnnotationFilter } from '../lib/model';
import { clampView, pan, span, zoomAround, type Limits, type View } from '../lib/scale';
import { newId, useStore } from '../lib/store';
import { BLANK_DOC, EVENT_KIND_LABEL, KIND_LABEL, type Annotation, type AtlasDoc, type EventKind, type ItemRef, type PhaseKind } from '../lib/types';
import { AnnotationsPanel } from './AnnotationsPanel';
import { ComparePanel } from './ComparePanel';
import { colorVar, EventShape, ItemCard, KindDefs, kindFill, StatusGlyph } from './marks';
import { NotesPanel } from './NotesPanel';
import { SettingsPanel } from './SettingsPanel';
import { Timeline, type Selection } from './Timeline';
import { TracksPanel } from './TracksPanel';

type Tab = 'annotations' | 'notes' | 'compare' | 'tracks' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'annotations', label: 'Annotations' },
  { id: 'notes', label: 'Notes' },
  { id: 'compare', label: 'Compare' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'settings', label: 'Settings' },
];

const todayString = (): string => new Date().toISOString().slice(0, 10);

export function App() {
  const store = useStore<AtlasDoc>('cycle-atlas:v1', BLANK_DOC);
  const doc = store.state;
  const [today] = useState(todayString);
  const nowYear = yearOf(today);
  const limits: Limits = useMemo(() => ({ min: 1750, max: nowYear + 14, minSpan: 8 }), [nowYear]);
  const presets = useMemo(
    () => [
      { label: 'All', view: { start: 1765, end: nowYear + 6 } },
      { label: 'Since 1900', view: { start: 1895, end: nowYear + 5 } },
      { label: 'Since 1970', view: { start: 1966, end: nowYear + 4 } },
    ],
    [nowYear],
  );
  const [view, setView] = useState<View>(() => presets[typeof window !== 'undefined' && window.innerWidth < 700 ? 1 : 0].view);
  const [tab, setTab] = useState<Tab>('annotations');
  const [selected, setSelected] = useState<Selection>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [filter, setFilter] = useState<AnnotationFilter>({ tag: '', status: 'active', text: '' });
  const [linkFrom, setLinkFrom] = useState<ItemRef | null>(null);
  const [linkNote, setLinkNote] = useState('');
  const [editTrackId, setEditTrackId] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const every = useMemo(() => allTracks(doc), [doc]);
  const shownTracks = useMemo(() => visibleTracks(doc), [doc]);
  const shownAnnotations = useMemo(() => filterAnnotations(doc.annotations, filter), [doc.annotations, filter]);
  const shownSeries = useMemo(() => doc.series.filter((s) => !s.hidden), [doc.series]);

  const openPanel = (t: Tab) => {
    setTab(t);
    // On a narrow screen the panel sits below the timeline: bring it into view.
    if (window.innerWidth < 1180) setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const startAnnotation = (a: Annotation) => {
    setDraft(a);
    openPanel('annotations');
  };

  const showAnnotation = (a: Annotation) => {
    setSelected({ type: 'ann', id: a.id });
    if (!filterAnnotations([a], filter).length) setFilter({ tag: '', status: a.status === 'dropped' ? 'all' : 'active', text: '' });
    const y = annotationYears(a, every, nowYear);
    if (y && (y.start < view.start || y.end > view.end)) {
      const s = Math.max(span(view), (y.end - y.start) * 1.4);
      const mid = (y.start + y.end) / 2;
      setView(clampView({ start: mid - s / 2, end: mid + s / 2 }, limits));
    }
  };

  const onSelect = (s: Selection) => {
    if (linkFrom && s?.type === 'item') {
      if (s.trackId === linkFrom.trackId) {
        setLinkNote('A link joins two different tracks. Pick an item on another lane.');
        return;
      }
      const track = findTrack(doc, s.trackId);
      const isEvent = track?.events.some((e) => e.id === s.itemId);
      const base = blankAnnotation('link', newId(), today, { year: nowYear });
      if (base.kind === 'link') startAnnotation({ ...base, from: linkFrom, to: { trackId: s.trackId, itemId: s.itemId, ...(isEvent ? {} : { edge: s.edge }) } });
      setLinkFrom(null);
      setLinkNote('');
      return;
    }
    setSelected(s);
    if (s?.type === 'ann') setTab('annotations');
  };

  const selTrack = selected?.type === 'item' ? every.find((t) => t.id === selected.trackId) : undefined;
  const selPhase = selected?.type === 'item' ? selTrack?.phases.find((p) => p.id === selected.itemId) : undefined;
  const selEvent = selected?.type === 'item' ? selTrack?.events.find((e) => e.id === selected.itemId) : undefined;

  const beginLink = (ref: ItemRef) => {
    setLinkFrom(ref);
    setLinkNote('');
    setSelected(null);
  };

  const kindsShown = [...new Set(shownTracks.flatMap((t) => t.phases.map((p) => p.kind)))] as PhaseKind[];
  const eventKindsShown = [...new Set(shownTracks.flatMap((t) => t.events.map((e) => e.kind)))] as EventKind[];
  const isPreset = (v: View) => Math.abs(v.start - view.start) < 0.01 && Math.abs(v.end - view.end) < 0.01;

  return (
    <div className="app atlas-app">
      <header className="top">
        <div>
          <h1>Cycle atlas</h1>
          <p className="muted">Published long-cycle chronologies on one time axis, with your own annotations, links and theory notes layered on top.</p>
        </div>
      </header>

      <div className="atlas">
        <div className="stage">
          <section className="card timeline-card">
            <div className="toolbar">
              <div className="seg" role="group" aria-label="Range">
                {presets.map((p) => (
                  <button key={p.label} className={isPreset(p.view) ? 'on' : ''} aria-pressed={isPreset(p.view)} onClick={() => setView(clampView(p.view, limits))}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="btn-row">
                <span className="muted small num" aria-live="off">
                  {Math.round(view.start)} to {Math.round(view.end)}
                </span>
                <button className="btn small" aria-label="Pan earlier" onClick={() => setView((v) => pan(v, -span(v) * 0.25, limits))}>
                  ←
                </button>
                <button className="btn small" aria-label="Zoom out" onClick={() => setView((v) => zoomAround(v, (v.start + v.end) / 2, 1.5, limits))}>
                  −
                </button>
                <button className="btn small" aria-label="Zoom in" onClick={() => setView((v) => zoomAround(v, (v.start + v.end) / 2, 1 / 1.5, limits))}>
                  +
                </button>
                <button className="btn small" aria-label="Pan later" onClick={() => setView((v) => pan(v, span(v) * 0.25, limits))}>
                  →
                </button>
              </div>
            </div>

            {linkFrom && (
              <div className="banner" role="status">
                <span>{linkNote || 'Linking: now click the second item, on a different lane.'}</span>
                <button className="btn small" onClick={() => { setLinkFrom(null); setLinkNote(''); }}>
                  Cancel
                </button>
              </div>
            )}

            {shownTracks.length === 0 && shownSeries.length === 0 ? (
              <p className="empty">
                Every track is hidden. <button className="linkish" onClick={() => setTab('tracks')}>Show some in the Tracks tab</button>.
              </p>
            ) : (
              <Timeline
                tracks={shownTracks}
                prefs={doc.trackPrefs}
                series={shownSeries}
                annotations={shownAnnotations}
                view={view}
                setView={setView}
                limits={limits}
                today={decimalYear(today)}
                selected={selected}
                onSelect={onSelect}
                onStartAnnotation={(year, trackId) => {
                  if (linkFrom) return;
                  startAnnotation(blankAnnotation('pin', newId(), today, { year, trackId }));
                }}
                onRedate={(trackId, phaseId, edge, year) => {
                  const t = doc.tracks.find((x) => x.id === trackId);
                  if (!t) return;
                  const next = redatePhase(t, phaseId, edge, year, nowYear);
                  if (next !== t) store.update((d) => updateTrack(d, trackId, (cur) => redatePhase(cur, phaseId, edge, year, nowYear)));
                }}
                svgRef={svgRef}
              />
            )}

            <details open>
              <summary>Key</summary>
              <div className="legend">
                {kindsShown.length > 0 && (
                  <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
                    <KindDefs prefix="lg" pairs={kindsShown.map((kind) => ({ color: 8, kind }))} />
                  </svg>
                )}
                {kindsShown.map((k) => (
                  <span key={k}>
                    <svg width={26} height={14} aria-hidden="true">
                      <rect x={0.5} y={0.5} width={25} height={13} rx={3} {...kindFill('lg', 8, k)} />
                    </svg>
                    {KIND_LABEL[k]}
                  </span>
                ))}
                <span>
                  <svg width={26} height={14} aria-hidden="true">
                    <rect x={1} y={1} width={24} height={12} rx={3} fill="none" stroke="var(--s8)" strokeDasharray="3 3" />
                  </svg>
                  Approximate date
                </span>
                {eventKindsShown.map((k) => (
                  <span key={k}>
                    <svg width={14} height={14} aria-hidden="true">
                      <EventShape kind={k} x={7} y={7} color={colorVar(8)} />
                    </svg>
                    {EVENT_KIND_LABEL[k]} event
                  </span>
                ))}
                {(['hunch', 'claim', 'tested', 'dropped'] as const).map((s) => (
                  <span key={s}>
                    <svg width={14} height={14} aria-hidden="true">
                      <StatusGlyph status={s} x={7} y={7} />
                    </svg>
                    {s[0].toUpperCase() + s.slice(1)}
                  </span>
                ))}
              </div>
              <p className="note-small" style={{ marginTop: 8 }}>
                Colour marks the track; the fill pattern and the label mark the kind of phase. Scroll or pinch to zoom, drag to pan, arrow keys and + or − when the timeline has focus. Click empty lane space to pin that year.
              </p>
            </details>
          </section>

          {selTrack && (selPhase || selEvent) && selected?.type === 'item' && (
            <section className="card detail" aria-label="Selected item">
              <ItemCard track={selTrack} phase={selPhase} event={selEvent} nowYear={nowYear} />
              <div className="btn-row">
                {selEvent && (
                  <>
                    <button className="btn small" onClick={() => startAnnotation(blankAnnotation('pin', newId(), today, { year: selEvent.year, trackId: selTrack.id }))}>
                      Pin {selEvent.year}
                    </button>
                    <button className="btn small" onClick={() => beginLink({ trackId: selTrack.id, itemId: selEvent.id })}>
                      Link from here
                    </button>
                  </>
                )}
                {selPhase && (
                  <>
                    <button
                      className="btn small"
                      onClick={() => {
                        const a = blankAnnotation('span', newId(), today, { year: selPhase.start, trackId: selTrack.id });
                        if (a.kind === 'span') startAnnotation({ ...a, end: selPhase.end ?? nowYear });
                      }}
                    >
                      Span this phase
                    </button>
                    <button className="btn small" onClick={() => beginLink({ trackId: selTrack.id, itemId: selPhase.id, edge: 'start' })}>
                      Link from its start ({selPhase.start})
                    </button>
                    {selPhase.end !== null && (
                      <button className="btn small" onClick={() => beginLink({ trackId: selTrack.id, itemId: selPhase.id, edge: 'end' })}>
                        Link from its end ({selPhase.end})
                      </button>
                    )}
                  </>
                )}
                {isBuiltin(selTrack.id) ? (
                  <button
                    className="btn small"
                    onClick={() => {
                      let id: string | null = null;
                      store.update((d) => {
                        const r = duplicateTrack(d, selTrack.id, newId);
                        id = r?.id ?? null;
                        return r ? r.doc : d;
                      });
                      if (id) {
                        setEditTrackId(id);
                        setEditItemId(null);
                        setSelected(null);
                        openPanel('tracks');
                      }
                    }}
                  >
                    Duplicate track to edit
                  </button>
                ) : (
                  <button
                    className="btn small"
                    onClick={() => {
                      setEditTrackId(selTrack.id);
                      setEditItemId(selected.itemId);
                      openPanel('tracks');
                    }}
                  >
                    Edit
                  </button>
                )}
                <button className="btn small" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="panel" ref={panelRef}>
          <nav className="tabs" aria-label="Panel">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'on' : ''} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          {tab === 'annotations' && (
            <AnnotationsPanel
              annotations={doc.annotations}
              tracks={every}
              nowYear={nowYear}
              draft={draft}
              setDraft={setDraft}
              isNew={draft ? !doc.annotations.some((a) => a.id === draft.id) : false}
              filter={filter}
              setFilter={setFilter}
              selectedId={selected?.type === 'ann' ? selected.id : null}
              onOpen={showAnnotation}
              onSave={(a) => {
                store.update((d) => upsertAnnotation(d, a, today));
                setDraft(null);
                showAnnotation(a);
              }}
              onDelete={(id) => {
                store.update((d) => deleteAnnotation(d, id));
                setDraft(null);
                setSelected(null);
              }}
              onStatus={(id, s) => store.update((d) => setStatus(d, id, s, today))}
              onNew={(kind) => setDraft(blankAnnotation(kind, newId(), today, { year: Math.round((view.start + view.end) / 2) }))}
            />
          )}
          {tab === 'notes' && (
            <NotesPanel
              notes={doc.notes}
              annotations={doc.annotations}
              today={today}
              onSave={(n) => store.update((d) => ({ ...d, notes: d.notes.some((x) => x.id === n.id) ? d.notes.map((x) => (x.id === n.id ? n : x)) : [...d.notes, n] }))}
              onDelete={(id) => store.update((d) => ({ ...d, notes: d.notes.filter((x) => x.id !== id) }))}
              onOpenAnnotation={(a) => {
                showAnnotation(a);
                setTab('annotations');
              }}
            />
          )}
          {tab === 'compare' && <ComparePanel tracks={shownTracks} nowYear={nowYear} />}
          {tab === 'tracks' && <TracksPanel doc={doc} update={store.update} nowYear={nowYear} editTrackId={editTrackId} setEditTrackId={setEditTrackId} editItemId={editItemId} setEditItemId={setEditItemId} />}
          {tab === 'settings' && <SettingsPanel store={store} tracks={shownTracks} view={view} today={today} svgRef={svgRef} />}
        </div>
      </div>
    </div>
  );
}
