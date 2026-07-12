"use client";
/**
 * PersonaSwitcher — small header dropdown that swaps the seeded demo
 * dataset.
 *
 * Behaviour:
 *   - Lists the three personas defined in lib/seedDemo.ts.
 *   - On selection: POSTs to /api/persona/switch, then calls
 *     `onSwitched()` so the parent can refetch entries.
 *   - Two-step confirm: the first click opens a "Replace current data?"
 *     inline confirm; the second click does the actual switch. This
 *     is a real wipe — the existing 200+ entries get deleted in a
 *     single transaction by the server. The confirm step is cheap
 *     insurance against an accidental tap during a live demo.
 *   - Disabled while a switch is in flight (button shows "Switching…").
 *
 * Lives only in the UI shell, so the seed module (server-only) is
 * never imported here — we just POST the persona name as JSON and
 * trust the server to validate.
 */

import { useEffect, useRef, useState } from "react";

import { PERSONAS, type PersonaName, type MetaSnapshot } from "@/lib/metaTypes";

interface PersonaSwitcherProps {
  current: PersonaName | null;
  onSwitched: (meta: MetaSnapshot) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "confirming"; target: PersonaName }
  | { kind: "switching"; target: PersonaName }
  | { kind: "error"; message: string };

export function PersonaSwitcher({ current, onSwitched }: PersonaSwitcherProps) {
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

  async function pick(target: PersonaName) {
    if (target === current) {
      setOpen(false);
      return;
    }
    // Already confirming this persona → commit.
    if (status.kind === "confirming" && status.target === target) {
      setStatus({ kind: "switching", target });
      try {
        const res = await fetch("/api/persona/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona: target }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Server returned ${res.status}`);
        }
        const json = (await res.json()) as { meta: MetaSnapshot };
        onSwitched(json.meta);
        setStatus({ kind: "idle" });
        setOpen(false);
      } catch (err) {
        setStatus({
          kind: "error",
          message:
            err instanceof Error
              ? `Couldn't switch persona: ${err.message}`
              : "Couldn't switch persona.",
        });
      }
      return;
    }
    // First click on a different persona → show inline confirm.
    setStatus({ kind: "confirming", target });
  }

  function cancelConfirm() {
    setStatus({ kind: "idle" });
  }

  const confirming = status.kind === "confirming" ? status.target : null;
  const switching = status.kind === "switching" ? status.target : null;
  const switchingName = switching ? PERSONAS[switching].label : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs font-semibold text-ink transition hover:border-signal hover:text-signal"
        title="Switch demo persona"
      >
        <PersonaIcon />
        <span className="hidden sm:inline">
          {switchingName ?? (current ? PERSONAS[current].label : "Switch persona")}
        </span>
        <span className="sm:hidden">Persona</span>
        <ChevronIcon className={open ? "rotate-180" : ""} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Choose a demo persona"
          className="absolute right-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Demo persona
          </div>
          <ul role="none" className="divide-y divide-border">
            {(Object.keys(PERSONAS) as PersonaName[]).map((name) => {
              const p = PERSONAS[name];
              const isCurrent = name === current;
              const isConfirming = confirming === name;
              return (
                <li key={name} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={Boolean(switching)}
                    onClick={() => pick(name)}
                    className="block w-full px-3 py-2.5 text-left transition hover:bg-surface-2 disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {p.label}
                      </span>
                      {isCurrent && (
                        <span className="num rounded-full bg-signal-soft px-1.5 py-0.5 text-[10px] font-semibold text-signal">
                          current
                        </span>
                      )}
                      {switching === name && (
                        <span className="num rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                          switching…
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted">
                      {p.description}
                    </p>
                    {isConfirming && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[11px] font-medium text-bkash">
                          Replace current data?
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelConfirm();
                          }}
                          className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink transition hover:border-signal"
                        >
                          Cancel
                        </button>
                        <span className="text-[11px] text-muted">
                          Tap {p.label} again to confirm
                        </span>
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {status.kind === "error" && (
            <div
              role="alert"
              className="border-t border-border px-3 py-2 text-[11px] font-medium text-bkash"
              style={{ backgroundColor: "rgba(224, 68, 122, 0.10)" }}
            >
              {status.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PersonaIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform ${className}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}