"use client";
/**
 * Theme preference: light | dark | system (follow OS). Persists across
 * reloads under the `walletsync.theme` localStorage key and is applied
 * to <html> via the inline THEME_BOOT script in app/layout.tsx so there
 * is no flash of wrong theme on first paint.
 *
 * Namespaces the localStorage key separately from liquiguard.theme —
 * both apps use the same zustand create + persist pattern, so users with
 * both apps installed on the same device get independent preferences.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  setResolved: (resolved: ResolvedTheme) => void;
  applyToDocument: () => void;
}

function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyResolved(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "light",
      resolved: "light",
      setMode: (mode) => {
        const resolved = resolveMode(mode);
        set({ mode, resolved });
        applyResolved(resolved);
      },
      setResolved: (resolved) => {
        set({ resolved });
        applyResolved(resolved);
      },
      applyToDocument: () => {
        applyResolved(get().resolved);
      },
    }),
    {
      name: "walletsync.theme",
      version: 1,
      partialize: (state) => ({ mode: state.mode }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const resolved = resolveMode(state.mode);
        state.resolved = resolved;
        applyResolved(resolved);
      },
    },
  ),
);
