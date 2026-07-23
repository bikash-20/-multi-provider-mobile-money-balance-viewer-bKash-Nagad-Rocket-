/**
 * useOnlineStatus — React hook for tracking navigator.onLine.
 *
 * Uses `useSyncExternalStore` for tear-free concurrent rendering.
 * Returns a plain object with:
 *  - `isOnline`: whether the browser currently reports connectivity.
 *  - `wasOffline`: true if we were offline at any point since this
 *    hook mounted. Useful for showing a "You're back online" toast
 *    without requiring a previous snapshot.
 *
 * The hook subscribes to `online`/`offline` events on `window` and
 * reads `navigator.onLine` as the snapshot. SSR-safe (returns
 * `isOnline: true` on the server to avoid hydration mismatch).
 */

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';

interface OnlineStatus {
  isOnline: boolean;
  wasOffline: boolean;
}

function getSnapshot(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

function getServerSnapshot(): boolean {
  return true;
}

export function useOnlineStatus(): OnlineStatus {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [wasOffline, setWasOffline] = useState(false);
  const prevRef = useRef(isOnline);

  // Track whether we've ever been offline since mount.
  if (prevRef.current !== isOnline) {
    prevRef.current = isOnline;
    if (!isOnline) setWasOffline(true);
  }

  // Reset `wasOffline` when the user comes back online.
  const resetWasOffline = useCallback(() => setWasOffline(false), []);

  return { isOnline, wasOffline, resetWasOffline } as OnlineStatus & {
    resetWasOffline: () => void;
  };
}
