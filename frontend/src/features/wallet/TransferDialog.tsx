"use client";
/**
 * TransferDialog — compose a cross-provider transfer.
 *
 * The dialog is a plain controlled modal. It does NOT manage the
 * balance refresh itself; on 201 it calls `onCommitted()` and the
 * parent re-fetches `/api/entries`. Validation runs locally so the
 * user gets instant feedback; the server still runs the same rules
 * and is the source of truth for conflict / insufficient-balance
 * responses.
 *
 * The submit affordance is disabled while the request is in flight,
 * while required fields are empty, or while the amount isn't a
 * positive finite number. Server-side errors (409, 422, 5xx) are
 * surfaced in the inline error banner without dismissing the dialog.
 */

import { useEffect, useRef, useState } from "react";

import {
  PROVIDER_LABEL,
  PROVIDERS,
  type Provider,
} from "@/features/wallet/types";

export interface TransferDialogProps {
  /** Provider that initiated the transfer (the card the user tapped). */
  defaultFrom: Provider;
  /** Per-provider current balances, used for the "destination has X"
   *  helper copy and the client-side pre-check. */
  balances: Record<Provider, number | undefined>;
  /** Called after the server returns 201. Parent re-fetches entries. */
  onCommitted: () => void;
  /** Close without committing. */
  onClose: () => void;
}

type FieldError = "empty" | "nonPositive" | "nan" | null;

function validateAmount(raw: string): { value: number | null; error: FieldError } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: "empty" };
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) return { value: null, error: "nan" };
  if (parsed <= 0) return { value: null, error: "nonPositive" };
  return { value: parsed, error: null };
}

const AMOUNT_ERROR_COPY: Record<Exclude<FieldError, null>, string> = {
  empty: "Enter an amount.",
  nonPositive: "Amount must be greater than zero.",
  nan: "Numbers only.",
};

const MAX_NOTE_LEN = 120;

export function TransferDialog({
  defaultFrom,
  balances,
  onCommitted,
  onClose,
}: TransferDialogProps) {
  // Sensible default for the destination: pick the first provider in
  // PROVIDERS that isn't defaultFrom. The user can change it.
  const defaultTo = PROVIDERS.find((p) => p !== defaultFrom) ?? "nagad";

  const [from, setFrom] = useState<Provider>(defaultFrom);
  const [to, setTo] = useState<Provider>(defaultTo);
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the amount field on open so the user can type immediately.
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>("input[data-autofocus]")?.focus();
  }, []);

  // Escape closes the dialog unless we're in the middle of a submit.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const { value: parsedAmount, error: amountError } = validateAmount(amount);
  const canSubmit =
    !submitting && parsedAmount !== null && amountError === null && from !== to;

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !submitting) onClose();
  }

  async function submit() {
    if (!canSubmit || parsedAmount === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          amountBdt: parsedAmount,
          note,
        }),
      });
      if (res.ok) {
        onCommitted();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Server returned ${res.status}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && canSubmit) {
      e.preventDefault();
      void submit();
    }
  }

  // Live helper text for the destination — "will receive X BDT"
  // computed from the parsed amount. Keeps the user oriented without
  // adding a separate results panel.
  const helperToBalance =
    parsedAmount !== null
      ? `Will move ৳${parsedAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })} to ${PROVIDER_LABEL[to]}.`
      : `Select a destination provider.`;

  const fromBalance = balances[from];
  const toBalance = balances[to];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Transfer between providers"
      onMouseDown={handleBackdrop}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-t-2xl border border-border bg-surface shadow-card sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-ink">Transfer between providers</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close transfer dialog"
            className="rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <select
                value={from}
                onChange={(e) => setFrom(e.target.value as Provider)}
                disabled={submitting}
                aria-label="Source provider"
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-signal disabled:cursor-not-allowed disabled:opacity-50"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABEL[p]}
                  </option>
                ))}
              </select>
              {fromBalance !== undefined && (
                <p className="mt-1 text-[11px] text-muted">
                  Available: ৳{fromBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </p>
              )}
            </Field>

            <Field label="To">
              <select
                value={to}
                onChange={(e) => setTo(e.target.value as Provider)}
                disabled={submitting}
                aria-label="Destination provider"
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-signal disabled:cursor-not-allowed disabled:opacity-50"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABEL[p]}
                  </option>
                ))}
              </select>
              {toBalance !== undefined && (
                <p className="mt-1 text-[11px] text-muted">
                  Currently: ৳{toBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </p>
              )}
            </Field>
          </div>

          {from === to && (
            <p role="alert" className="text-xs font-medium text-bkash">
              From and To must be different providers.
            </p>
          )}

          <Field label="Amount (BDT)">
            <input
              data-autofocus
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
              placeholder="0.00"
              aria-invalid={amountError !== null}
              aria-describedby="transfer-amount-err"
              className="num w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-2xl font-semibold text-ink outline-none placeholder:text-muted focus:border-signal disabled:cursor-not-allowed disabled:opacity-50"
            />
            {amountError && (
              <p id="transfer-amount-err" role="alert" className="mt-1 text-xs font-medium text-bkash">
                {AMOUNT_ERROR_COPY[amountError]}
              </p>
            )}
          </Field>

          <Field label={`Note (optional, ${note.length}/${MAX_NOTE_LEN})`}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LEN))}
              disabled={submitting}
              rows={2}
              placeholder="rent share, top-up, …"
              className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-signal disabled:cursor-not-allowed disabled:opacity-50"
            />
          </Field>

          <p className="text-xs text-muted">{helperToBalance}</p>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-bkash/40 bg-bkash/10 px-3 py-2 text-sm text-ink"
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-signal hover:text-signal disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="rounded-md bg-signal px-4 py-1.5 text-sm font-semibold text-ink transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Transferring…" : "Transfer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}