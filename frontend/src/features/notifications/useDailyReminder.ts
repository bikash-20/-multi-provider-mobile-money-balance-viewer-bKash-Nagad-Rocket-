"use client";
/**
 * useDailyReminder — React hook for the daily balance-update reminder.
 *
 * Behaviour:
 *  - Reads preferences from localStorage (`walletsync.reminder`).
 *  - Checks every 60 seconds whether it's time to fire a notification.
 *  - Fires exactly once per calendar day (tracks last-shown date).
 *  - Uses the ServiceWorker registration's `showNotification()` so the
 *    notification appears even when the tab is backgrounded.
 *  - Returns helpers to read/update preferences and permission status.
 *
 * localStorage schema (walletsync.reminder):
 *   {
 *     enabled: boolean,        // default false
 *     hour: number,            // 0-23, default 20 (8 PM)
 *     minute: number,          // 0-59, default 0
 *     lastShownDate: string | null  // ISO date YYYY-MM-DD of last fire
 *   }
 *
 * Permission:
 *  - The hook does NOT auto-request permission. It exposes a `request()`
 *    function that should be called from a user gesture (button click).
 *  - Permission state is tracked via `Notification.permission`.
 *
 * Time complexity: O(1) per check — just reads localStorage + Date.now().
 * Space complexity: O(1) — single interval + couple of refs.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface ReminderPrefs {
  enabled: boolean;
  hour: number;
  minute: number;
  lastShownDate: string | null;
}

const STORAGE_KEY = "walletsync.reminder";
const CHECK_INTERVAL_MS = 60_000; // check every minute
const DEFAULT_HOUR = 20; // 8 PM
const DEFAULT_MINUTE = 0;

type PermissionState = "default" | "granted" | "denied" | "unsupported";

interface UseDailyReminderReturn {
  /** Whether the reminder is enabled. */
  enabled: boolean;
  /** Reminder time (hour 0-23). */
  hour: number;
  /** Reminder time (minute 0-59). */
  minute: number;
  /** Current notification permission state. */
  permission: PermissionState;
  /** Enable/disable the reminder. */
  setEnabled: (v: boolean) => void;
  /** Set the reminder time (hour 0-23, minute 0-59). */
  setTime: (hour: number, minute: number) => void;
  /** Request notification permission (must be called from a user gesture). */
  requestPermission: () => Promise<boolean>;
  /** Send a test notification immediately. */
  sendTestNotification: () => Promise<boolean>;
}

/* ── localStorage helpers (O(1)) ──────────────────────────────────── */

function readPrefs(): ReminderPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: false, hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE, lastShownDate: null };
    const parsed = JSON.parse(raw) as Partial<ReminderPrefs>;
    return {
      enabled: parsed.enabled === true,
      hour: typeof parsed.hour === "number" && parsed.hour >= 0 && parsed.hour <= 23 ? parsed.hour : DEFAULT_HOUR,
      minute: typeof parsed.minute === "number" && parsed.minute >= 0 && parsed.minute <= 59 ? parsed.minute : DEFAULT_MINUTE,
      lastShownDate: typeof parsed.lastShownDate === "string" ? parsed.lastShownDate : null,
    };
  } catch {
    return { enabled: false, hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE, lastShownDate: null };
  }
}

function writePrefs(prefs: ReminderPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage full or unavailable — silently ignore.
  }
}

/* ── Notification display ─────────────────────────────────────────── */

async function showReminderNotification(
  title: string,
  body: string,
): Promise<boolean> {
  try {
    // Prefer SW registration so the notification works when tab is bg.
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body,
        icon: "/icons/icon-192.svg",
        badge: "/icons/icon-192.svg",
        tag: "walletsync-daily-reminder",
        requireInteraction: false,
      });
      return true;
    }
    // Fallback: page-context notification.
    const n = new Notification(title, {
      body,
      icon: "/icons/icon-192.svg",
      tag: "walletsync-daily-reminder",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/* ── Hook ─────────────────────────────────────────────────────────── */

export function useDailyReminder(): UseDailyReminderReturn {
  const [prefs, setPrefs] = useState<ReminderPrefs>(readPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const [permission, setPermission] = useState<PermissionState>(() => {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission as PermissionState;
  });

  // Sync permission changes from other tabs.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const handler = () => {
      setPermission(Notification.permission as PermissionState);
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // ── Check every 60s if we should fire a notification ──────────────
  useEffect(() => {
    const { enabled, hour, minute, lastShownDate } = prefs;
    if (!enabled) return;
    if (permission !== "granted") return;

    const interval = setInterval(() => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      // Already shown today? Skip.
      if (prefsRef.current.lastShownDate === today) return;

      // Is it time? (within this minute)
      if (currentHour === prefsRef.current.hour && currentMinute === prefsRef.current.minute) {
        // Fire the notification!
        const p = prefsRef.current;
        p.lastShownDate = today;
        writePrefs(p);
        setPrefs({ ...p });

        void showReminderNotification(
          "WalletSync — Daily Reminder",
          "Time to update your balances! Tap to open the dashboard.",
        );
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [prefs.enabled, prefs.hour, prefs.minute, permission]);

  // ── Actions ───────────────────────────────────────────────────────

  const setEnabled = useCallback((v: boolean) => {
    const next = { ...prefsRef.current, enabled: v };
    writePrefs(next);
    setPrefs(next);
  }, []);

  const setTime = useCallback((hour: number, minute: number) => {
    const h = Math.max(0, Math.min(23, Math.round(hour)));
    const m = Math.max(0, Math.min(59, Math.round(minute)));
    const next = { ...prefsRef.current, hour: h, minute: m };
    writePrefs(next);
    setPrefs(next);
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof Notification === "undefined") return false;
    try {
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);
      return result === "granted";
    } catch {
      return false;
    }
  }, []);

  const sendTestNotification = useCallback(async (): Promise<boolean> => {
    if (permission !== "granted") return false;
    return showReminderNotification(
      "WalletSync — Test Notification",
      "This is a test. Daily reminders are working!",
    );
  }, [permission]);

  return {
    enabled: prefs.enabled,
    hour: prefs.hour,
    minute: prefs.minute,
    permission,
    setEnabled,
    setTime,
    requestPermission,
    sendTestNotification,
  };
}
