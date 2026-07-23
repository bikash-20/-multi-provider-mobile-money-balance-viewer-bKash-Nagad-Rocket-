"use client";
/**
 * PWARegister — Registers the service worker and handles lifecycle.
 *
 * Responsibilities:
 *  1. Register `sw.js` on mount (only once per session).
 *  2. Watch for `updatefound` and `statechange` to detect when a new
 *     SW version is waiting.
 *  3. Fire `onUpdateReady` callback so a parent component can show an
 *     "Update available — refresh" prompt.
 *
 * This component renders nothing visually; the `onUpdateReady` callback
 * is the only external signal.
 */

import { useEffect, type ReactNode } from 'react';

interface PWARegisterProps {
  /** Called when a new SW version has been detected and is waiting. */
  onUpdateReady?: () => void;
  /** Optional children (rendered as-is). */
  children?: ReactNode;
}

export function PWARegister({ onUpdateReady, children }: PWARegisterProps) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
        if (cancelled) return;

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            if (cancelled) return;

            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // New SW installed and waiting for clients to close.
              onUpdateReady?.();
            }
          });
        });
      } catch {
        // Registration failure is non-fatal — the app works without SW.
      }
    };

    void register();

    return () => {
      cancelled = true;
    };
  }, [onUpdateReady]);

  return <>{children}</>;
}
