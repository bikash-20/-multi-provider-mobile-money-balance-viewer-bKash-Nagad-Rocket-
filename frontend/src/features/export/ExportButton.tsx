"use client";
/**
 * ExportButton — Dropdown for CSV download and Print/PDF export.
 *
 * Options:
 *  - Download All Entries (CSV)
 *  - Download All Transfers (CSV)
 *  - Download Statement: bKash | Nagad | Rocket (CSV)
 *  - Print / Save as PDF
 *
 * Design:
 *  - Compact dropdown that fits in the AppShell header
 *  - Uses the existing shell button pattern (border-border, bg-surface-2)
 *  - Closes on outside click / Escape
 *  - Shows loading state while download is in progress
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PROVIDERS, PROVIDER_LABEL, PROVIDER_HEX, type Provider } from "@/features/wallet/types";
import { csvFilename } from "./generateCsv";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; label: string }
  | { kind: "error"; message: string };

/**
 * Trigger a CSV download by fetching the export endpoint and piping
 * the response into a Blob download. Returns false on failure.
 */
async function downloadCsv(
  url: string,
  filename: string,
): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    return true;
  } catch {
    return false;
  }
}

export function ExportButton() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const rootRef = useRef<HTMLDivElement>(null);

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

  const handleDownload = useCallback(
    async (type: string, provider?: Provider) => {
      let url = `/api/export/csv?type=${encodeURIComponent(type)}`;
      let label = type;
      let filename = csvFilename(type);

      if (type === "statement" && provider) {
        url += `&provider=${encodeURIComponent(provider)}`;
        label = `statement-${provider}`;
        filename = csvFilename(`statement-${provider}`);
      }

      setStatus({ kind: "loading", label });
      const ok = await downloadCsv(url, filename);
      if (!ok) {
        setStatus({ kind: "error", message: `Download failed for ${label}.` });
        setTimeout(() => setStatus({ kind: "idle" }), 3000);
      } else {
        setStatus({ kind: "idle" });
        setOpen(false);
      }
    },
    [],
  );

  const handlePrint = useCallback(() => {
    setOpen(false);
    // Brief delay so the dropdown closes before print dialog opens.
    setTimeout(() => window.print(), 100);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={status.kind === "loading"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink shadow-card transition hover:border-signal hover:text-signal disabled:cursor-not-allowed disabled:opacity-50"
        title="Export data"
      >
        {status.kind === "loading" ? (
          <>
            <SpinnerIcon />
            <span className="hidden sm:inline">Exporting…</span>
          </>
        ) : (
          <>
            <DownloadIcon />
            <span className="hidden sm:inline">Export</span>
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Export options"
          className="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Download CSV
          </div>
          <ul role="none" className="divide-y divide-border">
            <MenuItem
              label="All Entries"
              icon={<TableIcon />}
              onClick={() => void handleDownload("entries")}
            />
            <MenuItem
              label="All Transfers"
              icon={<TransferIcon />}
              onClick={() => void handleDownload("transfers")}
            />

            {/* Per-provider statements */}
            <li role="none" className="border-t border-border">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Provider Statements
              </div>
              <ul role="none">
                {PROVIDERS.map((p) => (
                  <MenuItem
                    key={p}
                    label={PROVIDER_LABEL[p]}
                    icon={<DotIcon color={PROVIDER_HEX[p]} />}
                    onClick={() => void handleDownload("statement", p)}
                  />
                ))}
              </ul>
            </li>

            {/* Print / PDF separator */}
            <li role="none" className="border-t border-border">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Print / PDF
              </div>
              <MenuItem
                label="Print / Save as PDF"
                icon={<PrintIcon />}
                onClick={handlePrint}
              />
            </li>
          </ul>

          {status.kind === "error" && (
            <div
              role="alert"
              className="border-t border-border px-3 py-2 text-[11px] font-medium text-bkash"
              style={{ backgroundColor: "rgba(224, 68, 122, 0.08)" }}
            >
              {status.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────────── */

function MenuItem({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ink transition hover:bg-surface-2"
      >
        <span className="flex-none text-muted">{icon}</span>
        <span>{label}</span>
      </button>
    </li>
  );
}

/* ── Icons ────────────────────────────────────────────────────────── */

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  );
}

function TransferIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

function DotIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="6" fill={color} />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}


