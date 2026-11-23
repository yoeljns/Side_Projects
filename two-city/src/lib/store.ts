// One JSON document per app: kept in localStorage, optionally mirrored to
// Supabase under a sync code (see sync.ts). The newer copy wins as a whole.
import { useCallback, useEffect, useRef, useState } from 'react';
import { codeFromLocation, isSyncCode, pull, push, syncAvailable } from './sync';

type Stamped<T> = T & { updatedAt?: number };

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error';

export interface Store<T> {
  state: T;
  /** Change the document. Saves locally at once and to the sync code shortly after. */
  update: (fn: (s: T) => T) => void;
  /** Replace the whole document (restore from a file). */
  replace: (next: T) => void;
  syncCode: string | null;
  setSyncCode: (code: string | null) => void;
  syncStatus: SyncStatus;
  syncAvailable: boolean;
}

export function loadDoc<T extends object>(key: string, blank: T): Stamped<T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...blank, ...(JSON.parse(raw) as Partial<T>) } : blank;
  } catch {
    return blank;
  }
}

function saveDoc(key: string, doc: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(doc));
  } catch {
    // Private windows and full disks: keep working in memory.
  }
}

function readCode(key: string): string | null {
  const fromLink = typeof location === 'undefined' ? null : codeFromLocation();
  if (fromLink) {
    try {
      localStorage.setItem(`${key}:sync`, fromLink);
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      // ignore
    }
    return fromLink;
  }
  try {
    const saved = localStorage.getItem(`${key}:sync`);
    return saved && isSyncCode(saved) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * `key` is the localStorage key ("hours-ledger:v1"). `blank` supplies defaults
 * for any field missing from an older saved copy.
 */
export function useStore<T extends object>(key: string, blank: T): Store<T> {
  const [doc, setDoc] = useState<Stamped<T>>(() => loadDoc(key, blank));
  const [syncCode, setCode] = useState<string | null>(() => readCode(key));
  const [syncStatus, setStatus] = useState<SyncStatus>('off');
  const latest = useRef(doc);
  latest.current = doc;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const schedulePush = useCallback(
    (code: string | null) => {
      if (!code || !syncAvailable) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setStatus('syncing');
        push(code, latest.current).then(
          () => setStatus('synced'),
          () => setStatus('error'),
        );
      }, 800);
    },
    [],
  );

  const commit = useCallback(
    (next: T) => {
      const stamped = { ...next, updatedAt: Date.now() };
      latest.current = stamped;
      saveDoc(key, stamped);
      setDoc(stamped);
    },
    [key],
  );

  const update = useCallback(
    (fn: (s: T) => T) => {
      commit(fn(latest.current));
      schedulePush(syncCode);
    },
    [commit, schedulePush, syncCode],
  );

  const replace = useCallback(
    (next: T) => {
      commit({ ...blank, ...next });
      schedulePush(syncCode);
    },
    [blank, commit, schedulePush, syncCode],
  );

  // On start, when the code changes, and when the tab comes back: take the newer copy.
  useEffect(() => {
    if (!syncCode || !syncAvailable) {
      setStatus('off');
      return;
    }
    let cancelled = false;
    const reconcile = () => {
      setStatus('syncing');
      pull<Stamped<T>>(syncCode).then(
        (remote) => {
          if (cancelled) return;
          const local = latest.current;
          if (remote && (remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
            const merged = { ...blank, ...remote };
            latest.current = merged;
            saveDoc(key, merged);
            setDoc(merged);
            setStatus('synced');
          } else if (!remote || (local.updatedAt ?? 0) > (remote.updatedAt ?? 0)) {
            push(syncCode, local).then(
              () => !cancelled && setStatus('synced'),
              () => !cancelled && setStatus('error'),
            );
          } else {
            setStatus('synced');
          }
        },
        () => !cancelled && setStatus('error'),
      );
    };
    reconcile();
    const onVisible = () => document.visibilityState === 'visible' && reconcile();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncCode, key]);

  const setSyncCode = useCallback(
    (code: string | null) => {
      try {
        if (code) localStorage.setItem(`${key}:sync`, code);
        else localStorage.removeItem(`${key}:sync`);
      } catch {
        // ignore
      }
      setCode(code);
    },
    [key],
  );

  return { state: doc, update, replace, syncCode, setSyncCode, syncStatus, syncAvailable };
}

/** Small id for list items. */
export const newId = () => Math.random().toString(36).slice(2, 10);
