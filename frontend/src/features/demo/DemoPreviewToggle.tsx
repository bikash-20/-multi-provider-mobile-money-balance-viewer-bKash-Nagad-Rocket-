"use client";
/**
 * DemoPreviewToggle — Floating action button that toggles the demo
 * preview side panel.
 *
 * Renders a small pill button fixed at the bottom-right corner of the
 * viewport. When the panel is open, the button moves behind the panel;
 * when closed, it floats above the page content and pulses subtly to
 * catch attention.
 *
 * The dot indicator is green when demo data is active, muted otherwise.
 */

import { useEffect, useState } from "react";
import { DemoPreviewPanel, PANEL_W } from "./DemoPreviewPanel";
import { PERSONAS, type PersonaName } from "@/lib/metaTypes";

export function DemoPreviewToggle() {
  const [open, setOpen] = useState(false);
  const [initialPersona, setInitialPersona] = useState<PersonaName | null>(null);

  // If the URL contains ?demo=true, auto-open the panel on mount.
  // This enables direct-link sharing: anyone visiting the app with
  // the query param sees the demo preview immediately.
  // The param stays in the URL so bookmarks/refreshes still work.
  //
  // Optionally accept ?persona=freelancer|small_business|student to
  // pre-select a specific demo persona alongside the auto-open.
  // Combines with ?demo=true: e.g. ?demo=true&persona=freelancer
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);

    // Auto-open if demo=true
    if (params.get("demo") === "true") {
      setOpen(true);
    }

    // Capture persona param if it's a known persona name
    const rawPersona = params.get("persona");
    if (rawPersona && Object.keys(PERSONAS).includes(rawPersona)) {
      setInitialPersona(rawPersona as PersonaName);
    }
  }, []);

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 shadow-card transition-all duration-200 hover:scale-105 hover:shadow-lg active:scale-95"
        style={{
          // When panel is open, offset the button so it peeks from behind
          transform: open ? `translateX(-${PANEL_W}px)` : "translateX(0)",
        }}
        title={open ? "Close demo preview" : "Open demo preview"}
        aria-label="Toggle demo preview"
        aria-expanded={open}
      >
        {/* Live indicator dot — pulsing ring only shows briefly on first mount, not continuously */}
        <span
          className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"
          aria-hidden
        />

        <span className="text-[11px] font-semibold text-ink">Demo Preview</span>

        {/* Chevron indicator */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* The side panel */}
      <DemoPreviewPanel open={open} onClose={() => setOpen(false)} initialPersona={initialPersona} />
    </>
  );
}
