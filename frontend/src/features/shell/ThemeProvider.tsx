"use client";
/**
 * ThemeProvider — Hydration-safe theme bridge.
 *
 * Responsibilities:
 *  1. Syncs the zustand store's `resolved` theme to <html> via
 *     `applyToDocument()` after React mounts (the inline THEME_BOOT
 *     script already handles the first paint — this catches any
 *     divergence after hydration).
 *  2. Listens to `matchMedia('(prefers-color-scheme: dark)')` changes.
 *     When the store mode is "system", OS-level theme changes propagate
 *     immediately to the UI without a page reload.
 *  3. Cleans up the media query listener on unmount (no stale listeners).
 *
 * The provider is a no-op wrapper: it renders its children as-is and
 * does not add any DOM nodes. Every side-effect lives inside useEffect
 * so it is safe for SSR.
 */

import { useEffect } from "react";
import { useThemeStore } from "./themeStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useThemeStore((s) => s.mode);
  const setResolved = useThemeStore((s) => s.setResolved);
  const applyToDocument = useThemeStore((s) => s.applyToDocument);

  // Step 1 — Sync store to DOM after first hydration.
  // The inline boot script in layout.tsx handles the initial paint,
  // but if the store was rehydrated with a different value than what
  // the boot script computed (e.g. due to a zustand migration), this
  // ensures consistency.
  useEffect(() => {
    applyToDocument();
  }, [applyToDocument]);

  // Step 2 — Listen to OS-level theme changes when mode is "system".
  // Without this, users who switch their OS theme while the app is
  // open would need to reload the page or cycle the toggle to see
  // the change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (mode !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    function handleChange(e: MediaQueryListEvent) {
      setResolved(e.matches ? "dark" : "light");
    }

    // Modern browsers support addEventListener; Safari 14+ does too.
    // The 'change' event fires when the OS theme changes at runtime.
    mq.addEventListener("change", handleChange);

    return () => {
      mq.removeEventListener("change", handleChange);
    };
  }, [mode, setResolved]);

  return <>{children}</>;
}
