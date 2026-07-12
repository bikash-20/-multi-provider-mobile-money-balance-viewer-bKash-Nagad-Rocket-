"use client";
/**
 * ProviderBalanceCard — one card per provider.
 *
 * Behavior (per WalletSync spec section 3.2 + 5):
 *  - Renders the current balance as a large numeral, or an "—" placeholder
 *    if no entry exists yet.
 *  - "Update balance" / tapping the numeral turns it into an editable
 *    numeric input, pre-filled with the current value (or empty if none).
 *  - Confirm (checkmark or Enter) calls onUpdate and exits edit mode.
 *  - Cancel (X or Escape) reverts to display state with no mutation.
 *  - Negative numbers and non-numeric input are rejected inline; the
 *    submit affordance is disabled until the value parses to a
 *    non-negative finite number.
 *  - `disabled` disables the "Update balance" trigger (used during the
 *    initial fetch). `pending` visually marks an in-flight POST.
 */

import { useEffect, useRef, useState } from "react";
import {
  PROVIDER_HAIRLINE_CLASS,
  PROVIDER_LABEL,
  PROVIDER_HEX,
  type Provider,
} from "./types";
import { formatBDT, formatRelative } from "@/lib/time";

interface ProviderBalanceCardProps {
  provider: Provider;
  balance?: number;
  lastUpdated?: string;
  onUpdate: (newBalance: number) => void;
  disabled?: boolean;
  pending?: boolean;
}

type ValidationError = "empty" | "negative" | "nan" | null;

function validate(raw: string): { value: number | null; error: ValidationError } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: "empty" };
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) return { value: null, error: "nan" };
  if (parsed < 0) return { value: null, error: "negative" };
  return { value: parsed, error: null };
}

const ERROR_COPY: Record<Exclude<ValidationError, null>, string> = {
  empty: "Enter an amount.",
  negative: "Negative amounts are not allowed.",
  nan: "Numbers only.",
};

export function ProviderBalanceCard({
  provider,
  balance,
  lastUpdated,
  onUpdate,
  disabled = false,
  pending = false,
}: ProviderBalanceCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(balance?.toString() ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select on entry so the user can type to overwrite.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const { value, error } = validate(draft);
  const canSubmit = value !== null && error === null;

  function startEdit() {
    if (disabled) return;
    setDraft(balance?.toString() ?? "");
    setEditing(true);
  }

  function cancel() {
    setDraft(balance?.toString() ?? "");
    setEditing(false);
  }

  function confirm() {
    if (value === null) return;
    onUpdate(value);
    setEditing(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (canSubmit) confirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  return (
    <section
      aria-label={`${PROVIDER_LABEL[provider]} balance`}
      className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-card"
    >
      {/* 2px top hairline — keeps provider identity visible across themes. */}
      <div
        className={`h-0.5 w-full ${PROVIDER_HAIRLINE_CLASS[provider]}`}
        aria-hidden
      />

      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: PROVIDER_HEX[provider] }}
              aria-hidden
            />
            <span className="eyebrow">{PROVIDER_LABEL[provider]}</span>
            {pending && (
              <span
                aria-hidden
                className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-signal"
                title="Saving…"
              />
            )}
          </div>
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              disabled={disabled}
              className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink transition hover:border-signal hover:text-signal disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`Update ${PROVIDER_LABEL[provider]} balance`}
            >
              Update balance
            </button>
          )}
        </div>

        <div className="mt-3">
          {editing ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="num text-2xl text-muted">৳</span>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="decimal"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  aria-label={`New ${PROVIDER_LABEL[provider]} balance in BDT`}
                  aria-invalid={error !== null}
                  aria-describedby={`${provider}-err`}
                  className="num w-full bg-transparent text-3xl font-semibold text-ink outline-none placeholder:text-muted"
                  placeholder="0.00"
                />
              </div>
              {error && (
                <p
                  id={`${provider}-err`}
                  role="alert"
                  className="mt-1 text-xs font-medium text-bkash"
                >
                  {ERROR_COPY[error]}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-1 rounded-md bg-signal px-3 py-1.5 text-xs font-semibold text-ink transition disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Confirm new balance"
                >
                  <CheckIcon /> Confirm
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-signal hover:text-signal"
                  aria-label="Cancel update"
                >
                  <XIcon /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              disabled={disabled}
              className="block w-full text-left transition hover:opacity-80 disabled:cursor-not-allowed"
              aria-label={
                balance !== undefined
                  ? `Current balance ${formatBDT(balance)}. Tap to update.`
                  : `No balance recorded yet for ${PROVIDER_LABEL[provider]}. Tap to add one.`
              }
            >
              <span className="num block text-3xl font-semibold text-ink sm:text-4xl">
                {balance !== undefined ? formatBDT(balance) : "—"}
              </span>
              <span className="mt-1 block text-xs text-muted">
                {lastUpdated
                  ? `Updated ${formatRelative(lastUpdated) || "moments ago"}`
                  : "No entries yet"}
              </span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
