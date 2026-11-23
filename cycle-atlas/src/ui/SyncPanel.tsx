import { useRef, useState } from 'react';
import type { Store } from '../lib/store';
import { isSyncCode, newSyncCode, syncLink } from '../lib/sync';

/** Backup, restore and device sync for an app's document. Put it at the bottom of the page or in a Settings tab. */
export function SyncPanel<T extends object>({ store, filename }: { store: Store<T>; filename: string }) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const download = () => {
    const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const restore = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as T;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a backup');
      if (!confirm('Replace everything here with this file?')) return;
      store.replace(parsed);
      setNote('Restored.');
    } catch {
      setNote('That file is not a backup from this app.');
    }
  };

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote(done);
    } catch {
      setNote(text);
    }
  };

  const status = { off: '', syncing: 'Syncing…', synced: 'In sync', error: 'Sync failed, will retry on the next change' }[store.syncStatus];

  return (
    <section className="card sync">
      <div className="card-head">
        <h2>Backup and devices</h2>
        {status && <span className="muted small">{status}</span>}
      </div>
      <div className="btn-row">
        <button className="btn" onClick={download}>Download backup</button>
        <button className="btn" onClick={() => file.current?.click()}>Restore from file</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {!store.syncAvailable ? (
        <p className="muted small">Everything is saved in this browser. To share it between devices, set VITE_SUPABASE_URL and VITE_SUPABASE_KEY (see the README).</p>
      ) : store.syncCode ? (
        <>
          <p className="muted small">This device shares its data with every device that has the sync code. Treat the code like a password.</p>
          <div className="btn-row">
            <button className="btn" onClick={() => void copy(syncLink(store.syncCode!), 'Link copied. Open it on the other device.')}>Copy link for another device</button>
            <button className="btn" onClick={() => void copy(store.syncCode!, 'Code copied.')}>Copy code</button>
            <button className="btn" onClick={() => { if (confirm('Stop syncing on this device? Your data stays here.')) store.setSyncCode(null); }}>Stop syncing here</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">Sync is off. Start it here, or paste the code from a device that already syncs.</p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => store.setSyncCode(newSyncCode())}>Start syncing</button>
            <input aria-label="Sync code" placeholder="Paste a sync code" value={draft} onChange={(e) => setDraft(e.target.value.trim())} />
            <button className="btn" disabled={!isSyncCode(draft)} onClick={() => { store.setSyncCode(draft); setDraft(''); }}>Use code</button>
          </div>
        </>
      )}
      {note && <p className="small" role="status">{note}</p>}
    </section>
  );
}
