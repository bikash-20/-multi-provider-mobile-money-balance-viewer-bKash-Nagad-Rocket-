"use client";
/**
 * OfflineIndicator — collapsed banner showing offline status + sync state.
 *
 * Design:
 *  - When online with 0 pending mutations: renders nothing (no visual
 *    noise).
 *  - When offline: shows a compact amber bar at the top of the main
 *    content area, with the pending-mutation count and a "Retry" button.
 *  - When syncing: shows a spinning indicator with "Syncing…" label.
 *  - When a sync completes with permanent failures: shows the count with
 *    a subtle error treatment.
 *
 * The component uses the existing CSS token system (signal, muted, etc.)
 * so it integrates with light/dark themes automatically.
 *
 * Transitions:
 *  - Appears with a slide-down animation (280ms ease-out).
 *  - Disappears with a fade-out (200ms ease-in).
 *  - Respects prefers-reduced-motion.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCount, onCountChange, replayAll, clearQueue, type ReplayResult } from './syncQueue';
import { useOnlineStatus } from './useOnlineStatus';

interface OfflineIndicatorProps {
  /** Called after a successful sync so the parent can refetch data. */
  onSynced?: () => void;
}

type SyncState =
  | { kind: 'idle' }
  | { kind: 'syncing' }
  | { kind: 'error'; permanentFailures: number }
  | { kind: 'success' };

export function OfflineIndicator({ onSynced }: OfflineIndicatorProps) {
  const { isOnline } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>({ kind: 'idle' });
  const [visible, setVisible] = useState(false);
  const [mountRoot, setMountRoot] = useState(false);
  const prevOnline = useRef(isOnline);

  const mountedRef = useRef(true);

  // Subscribe to count changes.
  useEffect(() => {
    const unsub = onCountChange(setPendingCount);
    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, []);

  // Show when offline OR when there are pending changes.
  useEffect(() => {
    mountedRef.current = true;
    const shouldShow = !isOnline || pendingCount > 0;
    if (shouldShow && !mountRoot) setMountRoot(true);

    if (shouldShow) {
      const t = setTimeout(() => {
        if (mountedRef.current) setVisible(true);
      }, 16);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
      const t = setTimeout(() => {
        if (!mountedRef.current) return;
        setMountRoot(false);
        setSyncState({ kind: 'idle' });
      }, 200);
      return () => clearTimeout(t);
    }
  }, [isOnline, pendingCount, mountRoot]);

  // Auto-sync when coming back online.
  useEffect(() => {
    if (isOnline && !prevOnline.current && pendingCount > 0) {
      void handleReplay();
    }
    prevOnline.current = isOnline;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const handleReplay = useCallback(async () => {
    setSyncState({ kind: 'syncing' });
    const result = await replayAll();
    if (!mountedRef.current) return;

    if (result.permanentFailures.length > 0) {
      setSyncState({
        kind: 'error',
        permanentFailures: result.permanentFailures.length,
      });
    } else if (result.failed > 0) {
      setSyncState({ kind: 'idle' });
    } else {
      setSyncState({ kind: 'success' });
      setTimeout(() => {
        if (mountedRef.current) setSyncState({ kind: 'idle' });
      }, 3000);
    }
    onSynced?.();
  }, [onSynced]);

  const handleClearAll = useCallback(async () => {
    await clearQueue();
    setPendingCount(0);
    setSyncState({ kind: 'idle' });
  }, []);

  if (!mountRoot) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`
        overflow-hidden transition-all duration-200 ease-in-out
        ${visible ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0'}
      `}
    >
      <div className="rounded-lg border border-signal/30 bg-signal-soft/80 px-3 py-2 shadow-card backdrop-blur-sm">
        {syncState.kind === 'syncing' ? (
          <div className="flex items-center gap-2 text-xs font-semibold text-signal">
            <Spinner />
            Syncing {pendingCount} pending change{pendingCount !== 1 ? 's' : ''}…
          </div>
        ) : syncState.kind === 'success' ? (
          <div className="flex items-center gap-2 text-xs font-semibold text-signal">
            <CheckCircle />
            All changes synced
          </div>
        ) : syncState.kind === 'error' ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-bkash">
              <AlertIcon />
              {syncState.permanentFailures} sync error{syncState.permanentFailures !== 1 ? 's' : ''}
            </div>
            <button
              type="button"
              onClick={handleReplay}
              className="rounded-md border border-signal/40 bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-signal transition hover:bg-signal hover:text-ink"
            >
              Retry
            </button>
          </div>
        ) : !isOnline ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-signal">
              <OfflineIcon />
              Offline{pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
            </div>
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleReplay}
                    className="rounded-md border border-signal/40 bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-signal transition hover:bg-signal hover:text-ink"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted transition hover:border-muted hover:text-ink"
                    title="Discard all pending changes"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-signal">
              <ClockIcon />
              {pendingCount} pending change{pendingCount !== 1 ? 's' : ''}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReplay}
                className="rounded-md border border-signal/40 bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-signal transition hover:bg-signal hover:text-ink"
              >
                Sync now
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted transition hover:border-muted hover:text-ink"
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Icons ────────────────────────────────────────────────────────── */

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function OfflineIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M8.38 8.38A6 6 0 0 0 12 18h6" />
      <path d="M17.28 9.72A5.5 5.5 0 0 0 12 6a5.49 5.49 0 0 0-2 .38" />
    </svg>
  );
}

function CheckCircle() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
