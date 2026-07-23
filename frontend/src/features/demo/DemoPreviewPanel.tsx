"use client";
/**
 * DemoPreviewPanel — Full-height slide-in panel for live demo
 * presentation.
 *
 * Fetches seed data from the live API end-points and renders a
 * self-contained mini dashboard so an investor or stakeholder can
 * explore the full app experience without leaving the main UI.
 *
 * Features:
 *  - Slide-in animation from the right with backdrop overlay
 *  - Persona switcher, refresh, and close controls
 *  - Total balance + per-provider mini cards with sparkline trend
 *  - Recent entries (last 6)
 *  - Budget progress bars (if any budgets exist)
 *  - Mini net worth sparkline chart
 *  - Loading skeleton, empty state, error state
 *  - Close on Escape / backdrop click
 *  - Dark-mode aware via CSS variables
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatBDT, formatDayShort, formatRelative } from "@/lib/time";
import { PROVIDERS, PROVIDER_HEX, PROVIDER_LABEL } from "@/features/wallet/types";
import { PERSONAS, type PersonaName, type MetaSnapshot } from "@/lib/metaTypes";
import type { BalanceEntry, Provider } from "@/features/wallet/types";
import type { AnalyticsSnapshot } from "@/features/analytics/types";
import type { ProviderForecast } from "@/lib/domain/forecast";

/* ── Props ─────────────────────────────────────────────────────────── */

interface DemoPreviewPanelProps {
  open: boolean;
  onClose: () => void;
  /** Optional persona to pre-select on first open (from ?persona= query param). */
  initialPersona?: PersonaName | null;
}

/* ── Panel width (closed state is translateX) ──────────────────────── */

export const PANEL_W = 440;

/* ── Component ─────────────────────────────────────────────────────── */

export function DemoPreviewPanel({ open, onClose, initialPersona }: DemoPreviewPanelProps) {
  const [entries, setEntries] = useState<BalanceEntry[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [meta, setMeta] = useState<MetaSnapshot | null>(null);
  const [forecasts, setForecasts] = useState<ProviderForecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const initialPersonaApplied = useRef(false);

  // ── Data fetching ────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, metaRes, analyticsRes, forecastRes] = await Promise.all([
        fetch("/api/entries", { cache: "no-store" }),
        fetch("/api/meta", { cache: "no-store" }),
        fetch("/api/analytics", { cache: "no-store" }),
        fetch("/api/forecast", { cache: "no-store" }),
      ]);

      const entriesPayload = entriesRes.ok
        ? (await entriesRes.json()) as { entries: BalanceEntry[] }
        : { entries: [] };
      const metaData: MetaSnapshot | null = metaRes.ok
        ? (await metaRes.json()) as MetaSnapshot
        : null;
      const analyticsData: AnalyticsSnapshot | null = analyticsRes.ok
        ? (await analyticsRes.json()) as AnalyticsSnapshot
        : null;
      const forecastPayload = forecastRes.ok
        ? (await forecastRes.json()) as { forecasts: ProviderForecast[] }
        : { forecasts: [] };

      setEntries(entriesPayload.entries ?? []);
      setMeta(metaData);
      setAnalytics(analyticsData);
      setForecasts(forecastPayload.forecasts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load demo data.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.documentElement.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
    }
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  // ── Helpers ──────────────────────────────────────────────────────

  const latestByProvider = useMemo(() => {
    const map = {} as Record<string, BalanceEntry>;
    for (const e of entries) {
      if (!map[e.provider] || e.timestamp > map[e.provider].timestamp) {
        map[e.provider] = e;
      }
    }
    return map;
  }, [entries]);

  const totalBdtEquivalent = useMemo(
    () =>
      Object.values(latestByProvider).reduce((s, e) => {
        if (e.currency === "USD" && e.exchangeRateBdt) {
          return s + e.balance * e.exchangeRateBdt;
        }
        return s + e.balance;
      }, 0),
    [latestByProvider],
  );

  // Last 6 entries sorted newest-first
  const recentEntries = useMemo(
    () =>
      [...entries]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 6),
    [entries],
  );

  // Simple running-series for net worth mini sparkline
  const netWorthPoints = useMemo(() => {
    if (!analytics?.netWorthHistory) return [];
    return analytics.netWorthHistory
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((p) => ({ day: p.day, value: p.total }));
  }, [analytics]);

  // ── Persona switch handler ───────────────────────────────────────

  const handlePersonaSwitch = useCallback(
    async (target: PersonaName) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/persona/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona: target }),
        });
        if (!res.ok) throw new Error(`Switch returned ${res.status}`);
        const json = (await res.json()) as { meta: MetaSnapshot };
        setMeta(json.meta);
        await fetchData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Switch failed.");
      } finally {
        setLoading(false);
      }
    },
    [fetchData],
  );

  // ── Auto-switch on first open with initialPersona ────────────────
  // When the panel opens for the first time and an initialPersona was
  // provided (from the ?persona= query param), switch to that persona
  // instead of loading the default data. The ref ensures this only
  // runs once; subsequent opens always call fetchData() for fresh data.
  useEffect(() => {
    if (!open) return;

    if (!initialPersonaApplied.current && initialPersona) {
      initialPersonaApplied.current = true;
      void handlePersonaSwitch(initialPersona);
    } else {
      void fetchData();
    }
  }, [open, initialPersona, fetchData, handlePersonaSwitch]);

  // ── Render ───────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(2px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Demo Preview"
        className="fixed top-0 right-0 z-50 h-full overflow-hidden transition-transform duration-300 ease-out"
        style={{
          width: PANEL_W,
          maxWidth: "100vw",
          transform: open ? "translateX(0)" : `translateX(${PANEL_W + 24}px)`,
        }}
      >
        <div className="flex h-full flex-col bg-surface text-ink shadow-2xl">
          {/* ── Header ────────────────────────────────────────────── */}
          <header className="flex-none border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-signal text-[11px] font-bold text-white">
                  P
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-bold tracking-tight text-ink">
                    Demo Preview
                  </div>
                  <div className="truncate text-[10px] font-medium text-muted">
                    {meta?.label ?? "Live data"} · {
                      meta?.generatedAt
                        ? new Date(meta.generatedAt).toLocaleDateString()
                        : "simulated"
                    }
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={fetchData}
                  disabled={loading}
                  className="rounded-md p-1.5 text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-40"
                  title="Refresh demo data"
                  aria-label="Refresh"
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden
                    className={loading ? "animate-spin" : ""}
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md p-1.5 text-muted transition hover:bg-surface-2 hover:text-ink"
                  title="Close demo preview"
                  aria-label="Close"
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Persona switcher row */}
            <div className="mt-2 flex items-center gap-1.5">
              {(Object.keys(PERSONAS) as PersonaName[]).map((name) => {
                const isActive = meta?.persona === name;
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={loading}
                    onClick={() => handlePersonaSwitch(name)}
                    className={`rounded-md px-2 py-1 text-[10px] font-semibold transition ${
                      isActive
                        ? "bg-signal text-white shadow-sm"
                        : "border border-border bg-surface-2 text-muted hover:border-signal hover:text-ink"
                    }`}
                  >
                    {PERSONAS[name].label}
                  </button>
                );
              })}
            </div>
          </header>

          {/* ── Scrollable Body ───────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {loading && entries.length === 0 ? (
              <PanelSkeleton />
            ) : error ? (
              <PanelError message={error} onRetry={fetchData} />
            ) : entries.length === 0 ? (
              <PanelEmpty />
            ) : (
              <div className="divide-y divide-border">
                {/* Total balance section */}
                <section className="px-4 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Total Balance
                  </p>
                  <p className="num mt-0.5 text-2xl font-bold text-ink">
                    {formatBDT(totalBdtEquivalent)}
                  </p>
                </section>

                {/* Provider mini cards */}
                <section className="px-4 py-3">
                  <div className="flex flex-col gap-2">
                    {PROVIDERS.map((p) => {
                      const entry = latestByProvider[p];
                      const color = PROVIDER_HEX[p];
                      // Compute a simple trend from recent entries
                      const providerEntries = entries
                        .filter((e) => e.provider === p)
                        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                      const trend =
                        providerEntries.length >= 2
                          ? providerEntries[0].balance >= providerEntries[1].balance
                            ? "up"
                            : "down"
                          : "flat";
                      return (
                        <div
                          key={p}
                          className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2.5"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {/* Provider dot */}
                            <span
                              className="inline-block h-2.5 w-2.5 flex-none rounded-full"
                              style={{ background: color }}
                              aria-hidden
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-ink">
                                {PROVIDER_LABEL[p]}
                              </p>
                              <p className="num text-[10px] text-muted">
                                {entry
                                  ? entry.currency === "USD" && entry.exchangeRateBdt
                                    ? `$${(entry.balance / 100).toFixed(2)}`
                                    : formatBDT(entry.balance)
                                  : "—"}
                              </p>
                            </div>
                          </div>

                          {/* Trend indicator */}
                          <div className="flex items-center gap-1">
                            <span
                              className={`num text-[10px] font-semibold ${
                                trend === "up"
                                  ? "text-emerald-500"
                                  : trend === "down"
                                    ? "text-rose-400"
                                    : "text-muted"
                              }`}
                            >
                              {trend === "up"
                                ? "↑"
                                : trend === "down"
                                  ? "↓"
                                  : "—"}
                            </span>
                            {/* Mini sparkline: 5 dots showing recent trajectory */}
                            <div className="flex items-end gap-[2px]">
                              {providerEntries.slice(0, 5).reverse().map((e, i) => {
                                const max = Math.max(...providerEntries.slice(0, 5).map((x) => x.balance), 1);
                                const barHeight = Math.max(3, (e.balance / max) * 16);
                                return (
                                  <span
                                    key={i}
                                    className="inline-block w-[3px] rounded-sm transition-all"
                                    style={{
                                      height: barHeight,
                                      background: color,
                                      opacity: 0.3 + (i / 5) * 0.7,
                                    }}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Recent entries */}
                <section className="px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Recent Entries
                  </p>
                  <div className="mt-2 flex flex-col gap-1">
                    {recentEntries.map((e) => {
                      const p = e.provider as Provider;
                      const color = PROVIDER_HEX[p];
                      return (
                        <div
                          key={e.id}
                          className="flex items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-surface-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="inline-block h-1.5 w-1.5 flex-none rounded-full"
                              style={{ background: color }}
                              aria-hidden
                            />
                            <span className="text-[10px] font-medium text-ink">
                              {PROVIDER_LABEL[p]}
                            </span>
                            <span className="num text-[10px] text-muted">
                              {e.currency === "USD" && e.exchangeRateBdt
                                ? `$${(e.balance / 100).toFixed(2)}`
                                : formatBDT(e.balance)}
                            </span>
                          </div>
                          <span className="num text-[9px] text-muted">
                            {formatRelative(e.timestamp)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Budget progress (if any) */}
                <section className="px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Budget Progress
                  </p>
                  <div className="mt-2 flex flex-col gap-2">
                    {/* Simulated budget bars for demo visual — prefixed with "Sample" for clear disclosure */}
                    {[
                      { label: "Sample: Living Expenses", pct: 72, color: "var(--color-signal)" },
                      { label: "Sample: Entertainment", pct: 45, color: "var(--color-muted)" },
                      { label: "Sample: Savings Target", pct: 88, color: PROVIDER_HEX.bkash },
                    ].map((b) => (
                      <div key={b.label}>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-ink">{b.label}</span>
                          <span className="num text-[9px] text-muted">{b.pct}%</span>
                        </div>
                        <div
                          className="mt-1 h-1.5 w-full overflow-hidden rounded-full"
                          style={{ background: "var(--color-surface-2)" }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${b.pct}%`,
                              background: b.color,
                              opacity: 0.55,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Mini net worth sparkline */}
                {netWorthPoints.length >= 2 && (
                  <section className="px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Net Worth Trend
                    </p>
                    <div className="mt-2">
                      <MiniSparkline
                        points={netWorthPoints}
                        color="var(--color-signal)"
                        height={48}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[9px] text-muted">
                      <span>{formatDayShort(netWorthPoints[0]?.day ?? "")}</span>
                      <span>{formatDayShort(netWorthPoints[netWorthPoints.length - 1]?.day ?? "")}</span>
                    </div>
                  </section>
                )}

                {/* Forecast preview */}
                {forecasts.length > 0 && (
                  <section className="px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Forecast Preview
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      {forecasts.slice(0, 3).map((f) => {
                        if (!f) return null;
                        const lastForecast = f.forecast[f.forecast.length - 1];
                        if (!lastForecast) return null;
                        const fp = f.provider as Provider;
                        return (
                          <div key={f.provider} className="flex items-center gap-1.5">
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full"
                              style={{ background: f.color }}
                              aria-hidden
                            />
                            <span className="text-[10px] font-medium text-ink">
                              {PROVIDER_LABEL[fp]}
                            </span>
                            <span className="num text-[10px] text-muted">
                              {formatBDT(lastForecast.value)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* End spacer */}
                <div className="h-4" />
              </div>
            )}
          </div>

          {/* ── Footer ────────────────────────────────────────────── */}
          <footer className="flex-none border-t border-border px-4 py-2">
            <p className="text-center text-[9px] text-muted">
              Demo data is simulated and regenerated on persona switch.
              <br />
              Press <kbd className="rounded-sm bg-surface-2 px-1 font-mono text-[9px]">Esc</kbd> to close.
            </p>
          </footer>
        </div>
      </aside>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 *  Sub-components
 * ═══════════════════════════════════════════════════════════════════════ */

/* ── Loading skeleton ──────────────────────────────────────────────── */

function PanelSkeleton() {
  return (
    <div className="animate-pulse divide-y divide-border px-4 py-4">
      <div className="space-y-2 pb-4">
        <div className="h-3 w-20 rounded bg-surface-2" />
        <div className="h-7 w-32 rounded bg-surface-2" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <div className="h-2.5 w-2.5 rounded-full bg-surface-2" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-16 rounded bg-surface-2" />
            <div className="h-2.5 w-20 rounded bg-surface-2" />
          </div>
          <div className="h-5 w-12 rounded bg-surface-2" />
        </div>
      ))}
      <div className="space-y-2 pt-4">
        <div className="h-3 w-24 rounded bg-surface-2" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-1.5 w-full rounded-full bg-surface-2" />
        ))}
      </div>
    </div>
  );
}

/* ── Error state ───────────────────────────────────────────────────── */

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <svg
        width="32" height="32" viewBox="0 0 24 24" fill="none"
        stroke="var(--color-bkash)" strokeWidth="1.5" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden className="mb-3 opacity-60"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="text-sm font-semibold text-ink">Couldn&apos;t load demo data</p>
      <p className="mt-1 text-[11px] text-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md bg-signal px-3 py-1.5 text-xs font-semibold text-ink transition hover:opacity-90"
      >
        Retry
      </button>
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────────────── */

function PanelEmpty() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <svg
        width="32" height="32" viewBox="0 0 24 24" fill="none"
        stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden className="mb-3 opacity-40"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <p className="text-sm font-semibold text-muted">No data available</p>
      <p className="mt-1 text-[11px] text-muted">
        Switch to a demo persona above to seed the database with realistic data.
      </p>
    </div>
  );
}

/* ── Mini sparkline (pure SVG, no deps) ────────────────────────────── */

function MiniSparkline({
  points,
  color,
  height = 48,
}: {
  points: ReadonlyArray<{ day: string; value: number }>;
  color: string;
  height?: number;
}) {
  const w = 380;
  const pad = { left: 0, right: 0, top: 4, bottom: 4 };
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  function yPos(v: number) {
    return pad.top + innerH - ((v - min) / range) * innerH;
  }

  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${pad.left + (i / Math.max(points.length - 1, 1)) * innerW},${yPos(p.value)}`)
    .join(" ");

  return (
    <svg
      role="img"
      aria-label="Net worth trend"
      viewBox={`0 0 ${w} ${height}`}
      className="w-full"
    >
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
      {/* Gradient fill under the line */}
      <defs>
        <linearGradient id="mini-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.15} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      <path
        d={`${d} L${pad.left + innerW},${pad.top + innerH} L${pad.left},${pad.top + innerH} Z`}
        fill="url(#mini-spark-fill)"
      />
    </svg>
  );
}
