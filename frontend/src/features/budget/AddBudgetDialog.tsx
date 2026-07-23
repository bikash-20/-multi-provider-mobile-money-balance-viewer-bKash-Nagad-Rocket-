"use client";
/**
 * AddBudgetDialog — Modal dialog for creating a new monthly budget.
 *
 * Fields:
 *  - Name (e.g., "Groceries", "Eating Out")
 *  - Monthly amount in BDT
 *  - Category (free-text or picklist)
 *  - Rollover toggle (unused amount carries to next month)
 *
 * Design matches TransferDialog conventions.
 */

import { useState, useEffect, useRef } from "react";
import { addBudget, makeBudgetId, currentMonthKey } from "./budgetStore";
import type { Budget } from "./types";

interface AddBudgetDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

const CATEGORIES = [
  "Food",
  "Transport",
  "Entertainment",
  "Shopping",
  "Bills",
  "Health",
  "Education",
  "Other",
];

export function AddBudgetDialog({ onClose, onCreated }: AddBudgetDialogProps) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Other");
  const [rollover, setRollover] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>("input[data-autofocus]")?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const parsedAmount = Number(amount);
  const canSubmit =
    !submitting &&
    name.trim().length > 0 &&
    amount.trim().length > 0 &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0;

  function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const budget: Budget = {
        id: makeBudgetId(),
        name: name.trim(),
        amount: Math.round(parsedAmount * 100) / 100,
        category,
        month: currentMonthKey(),
        rollover,
        createdAt: new Date().toISOString(),
      };
      addBudget(budget);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create budget.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !submitting) onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add budget"
      onMouseDown={handleBackdrop}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
    >
      <div ref={dialogRef} className="w-full max-w-sm rounded-t-2xl border border-border bg-surface shadow-card sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Add Monthly Budget</h2>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" className="rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 p-4">
          <Field label="Budget name">
            <input
              data-autofocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Groceries"
              disabled={submitting}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-signal disabled:opacity-50"
            />
          </Field>

          <Field label="Monthly amount (BDT)">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5000"
              disabled={submitting}
              className="num w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-2xl font-semibold text-ink outline-none placeholder:text-muted focus:border-signal disabled:opacity-50"
            />
          </Field>

          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-signal disabled:opacity-50"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rollover}
              onChange={(e) => setRollover(e.target.checked)}
              disabled={submitting}
              className="h-4 w-4 rounded border-border bg-surface-2 text-signal focus:ring-signal"
            />
            <span className="text-xs text-muted">
              Roll over unused amount to next month
            </span>
          </label>

          {error && (
            <div role="alert" className="rounded-md border border-bkash/40 bg-bkash/10 px-3 py-2 text-sm text-ink">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-signal disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="rounded-md bg-signal px-4 py-1.5 text-sm font-semibold text-ink transition disabled:opacity-40">
            {submitting ? "Creating…" : "Create Budget"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
