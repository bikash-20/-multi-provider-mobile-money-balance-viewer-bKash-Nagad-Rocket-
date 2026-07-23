"use client";
/**
 * AddGoalDialog — Modal dialog for creating a savings goal.
 *
 * Fields:
 *  - Goal name (e.g., "New Laptop", "Emergency Fund")
 *  - Description (optional)
 *  - Target amount in BDT
 *  - Current amount saved (default 0)
 *  - Deadline date (optional)
 */

import { useState, useEffect, useRef } from "react";
import { addGoal, makeGoalId } from "./budgetStore";
import type { SavingsGoal } from "./types";

interface AddGoalDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

export function AddGoalDialog({ onClose, onCreated }: AddGoalDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [currentAmount, setCurrentAmount] = useState("0");
  const [deadline, setDeadline] = useState("");
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

  const parsedTarget = Number(targetAmount);
  const parsedCurrent = Number(currentAmount);
  const canSubmit =
    !submitting &&
    name.trim().length > 0 &&
    targetAmount.trim().length > 0 &&
    Number.isFinite(parsedTarget) &&
    parsedTarget > 0 &&
    Number.isFinite(parsedCurrent) &&
    parsedCurrent >= 0;

  function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const goal: SavingsGoal = {
        id: makeGoalId(),
        name: name.trim(),
        description: description.trim(),
        targetAmount: Math.round(parsedTarget * 100) / 100,
        currentAmount: Math.round(parsedCurrent * 100) / 100,
        deadline: deadline.trim() || null,
        createdAt: new Date().toISOString(),
      };
      addGoal(goal);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create goal.");
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
      aria-label="Add savings goal"
      onMouseDown={handleBackdrop}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
    >
      <div ref={dialogRef} className="w-full max-w-sm rounded-t-2xl border border-border bg-surface shadow-card sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Add Savings Goal</h2>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" className="rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 p-4">
          <Field label="Goal name">
            <input data-autofocus type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Laptop" disabled={submitting} className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-signal disabled:opacity-50" />
          </Field>

          <Field label="Description (optional)">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Save up for the new MacBook Pro" disabled={submitting} className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-signal disabled:opacity-50" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Target (BDT)">
              <input type="text" inputMode="decimal" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="50000" disabled={submitting} className="num w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-lg font-semibold text-ink outline-none placeholder:text-muted focus:border-signal disabled:opacity-50" />
            </Field>

            <Field label="Saved so far (BDT)">
              <input type="text" inputMode="decimal" value={currentAmount} onChange={(e) => setCurrentAmount(e.target.value)} placeholder="0" disabled={submitting} className="num w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-lg font-semibold text-ink outline-none placeholder:text-muted focus:border-signal disabled:opacity-50" />
            </Field>
          </div>

          <Field label="Deadline (optional)">
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} disabled={submitting} className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-signal disabled:opacity-50" />
          </Field>

          {error && (
            <div role="alert" className="rounded-md border border-bkash/40 bg-bkash/10 px-3 py-2 text-sm text-ink">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-signal disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="rounded-md bg-signal px-4 py-1.5 text-sm font-semibold text-ink transition disabled:opacity-40">
            {submitting ? "Creating…" : "Create Goal"}
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
