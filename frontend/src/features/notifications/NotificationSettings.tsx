"use client";
/**
 * NotificationSettings — Dropdown for configuring daily reminders.
 *
 * Features:
 *  - Enable/disable toggle
 *  - Time picker (hour:minute) for the reminder time
 *  - Permission status indicator with "Enable notifications" button
 *  - "Test notification" button to verify setup
 *  - Closes on outside click / Escape
 *
 * Design matches PersonaSwitcher and ExportButton dropdown conventions.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDailyReminder } from "./useDailyReminder";

export function NotificationSettings() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const {
    enabled,
    hour,
    minute,
    permission,
    setEnabled,
    setTime,
    requestPermission,
    sendTestNotification,
  } = useDailyReminder();

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleToggle = useCallback(() => {
    if (!enabled && permission !== "granted") {
      // If not yet granted, request permission first.
      void requestPermission().then((granted) => {
        if (granted) setEnabled(true);
      });
    } else {
      setEnabled(!enabled);
    }
  }, [enabled, permission, requestPermission, setEnabled]);

  const [editingHour, setEditingHour] = useState(hour);
  const [editingMinute, setEditingMinute] = useState(minute);

  // Sync local edit state when dropdown opens or prefs change.
  useEffect(() => {
    if (open) {
      setEditingHour(hour);
      setEditingMinute(minute);
    }
  }, [open, hour, minute]);

  const handleTimeChange = (h: number, m: number) => {
    setEditingHour(h);
    setEditingMinute(m);
    setTime(h, m);
  };

  const timeLabel = `${String(editingHour).padStart(2, "0")}:${String(editingMinute).padStart(2, "0")}`;

  const isUnsupported = permission === "unsupported";
  const isDenied = permission === "denied";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-card transition hover:border-signal hover:text-signal ${
          enabled ? "border-signal/50 bg-signal-soft/60 text-signal" : "border-border bg-surface-2 text-ink"
        }`}
        title="Daily reminder settings"
      >
        <BellIcon active={enabled} />
        <span className="hidden sm:inline">{enabled ? timeLabel : "Reminder"}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Daily reminder settings"
          className="absolute right-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Daily Reminder
          </div>

          <div className="space-y-3 p-3">
            {/* Permission status */}
            {isUnsupported && (
              <p className="text-[11px] text-muted">
                Notifications are not supported in this browser.
              </p>
            )}
            {isDenied && (
              <p className="text-[11px] font-medium text-bkash">
                Notifications blocked. Enable them in your browser settings.
              </p>
            )}

            {/* Enable toggle */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-ink">Daily reminder</p>
                <p className="text-[10px] text-muted">
                  {enabled
                    ? `Notifies you at ${timeLabel} every day`
                    : "Get a nudge to update your balances"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={isUnsupported || isDenied}
                onClick={handleToggle}
                className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition ${
                  enabled ? "bg-signal" : "bg-surface-2"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    enabled ? "translate-x-[18px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
            </div>

            {/* Time picker (only shown when enabled) */}
            {enabled && (
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Reminder time
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={editingHour}
                    onChange={(e) => handleTimeChange(Number(e.target.value), editingMinute)}
                    aria-label="Hour"
                    className="num w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-ink outline-none focus:border-signal"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {String(i).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted">:</span>
                  <select
                    value={editingMinute}
                    onChange={(e) => handleTimeChange(editingHour, Number(e.target.value))}
                    aria-label="Minute"
                    className="num w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-ink outline-none focus:border-signal"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i} value={i * 5}>
                        {String(i * 5).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Permission request button */}
            {permission === "default" && !enabled && (
              <button
                type="button"
                onClick={() => void requestPermission()}
                className="w-full rounded-md bg-signal px-3 py-1.5 text-xs font-semibold text-ink transition hover:opacity-90"
              >
                Enable notifications
              </button>
            )}

            {/* Test notification */}
            {permission === "granted" && (
              <button
                type="button"
                onClick={() => void sendTestNotification()}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-signal hover:text-signal"
              >
                Send test notification
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Bell icon ────────────────────────────────────────────────────── */

function BellIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={active ? "var(--color-signal)" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      {active && (
        <circle cx="19" cy="5" r="3" fill="var(--color-bkash)" stroke="none" />
      )}
    </svg>
  );
}
