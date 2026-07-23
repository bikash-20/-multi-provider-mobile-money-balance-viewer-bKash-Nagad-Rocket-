/**
 * features/budget/computeSpending.ts — Pure functions for deriving
 * actual spending/income from balance entries.
 *
 * Each function is a pure transformation: entries[] -> numbers.
 * No React, no localStorage, no side effects. Testable in isolation.
 * O(n) time, O(1) space.
 */

import type { BalanceEntry, Provider } from "@/features/wallet/types";
import type { BudgetWithActual, GoalWithProgress, MonthlySpending, SavingsGoal } from "./types";

/**
 * Compute monthly spending from balance entries.
 *
 * Strategy: sort entries by timestamp ascending, then compute
 * day-over-day balance changes per provider. Sum all negative
 * changes (outflows) and positive changes (inflows).
 *
 * USD entries are converted to BDT using their stored exchangeRateBdt
 * before aggregation.
 *
 * @param entries — All balance entries (newest-first or unsorted).
 * @param month — YYYY-MM target month.
 */
export function computeMonthlySpending(
  entries: BalanceEntry[],
  month: string,
): MonthlySpending {
  // Filter entries for the target month.
  const monthEntries = entries.filter((e) => e.timestamp.startsWith(month));
  if (monthEntries.length === 0) {
    return { month, totalSpent: 0, totalIncome: 0, netChange: 0 };
  }

  // Sort ascending by timestamp for chronological processing.
  const sorted = [...monthEntries].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );

  // Track last seen balance per provider to compute day-over-day deltas.
  const lastSeen = new Map<Provider, { balance: number; isUsd: boolean; rate: number }>();
  let totalSpent = 0;
  let totalIncome = 0;

  for (const e of sorted) {
    const prev = lastSeen.get(e.provider);
    const balance = normalizeToBdt(e);
    const isUsd = e.currency === "USD";
    const rate = isUsd && e.exchangeRateBdt ? e.exchangeRateBdt : 1;

    if (prev) {
      // Convert both to BDT for comparison.
      const prevBdt = prev.isUsd ? prev.balance * prev.rate : prev.balance;
      const currBdt = isUsd ? balance * rate : balance;
      const diff = currBdt - prevBdt;

      if (diff < 0) totalSpent += Math.abs(diff);
      else if (diff > 0) totalIncome += diff;
    }

    lastSeen.set(e.provider, { balance, isUsd, rate });
  }

  return {
    month,
    totalSpent: Math.round(totalSpent * 100) / 100,
    totalIncome: Math.round(totalIncome * 100) / 100,
    netChange: Math.round((totalIncome - totalSpent) * 100) / 100,
  };
}

/** Attach actual spending to a list of budgets. O(b + e) where b = budgets,
 *  e = entries. Pure. */
export function computeBudgetWithActuals(
  budgets: { id: string; name: string; amount: number; category: string; month: string; rollover: boolean; createdAt: string }[],
  monthSpending: MonthlySpending,
): BudgetWithActual[] {
  return budgets.map((b) => {
    // If rollover and this is NOT the current month, use 0 as baseline
    // (the rollover amount was already counted in the current month's budget).
    const actualSpent = b.rollover
      ? Math.min(monthSpending.totalSpent, b.amount)
      : monthSpending.totalSpent;
    const remaining = b.amount - actualSpent;
    const percentUsed = b.amount > 0 ? (actualSpent / b.amount) * 100 : 0;

    let status: "on_track" | "overspent" | "underspent";
    if (percentUsed > 100) status = "overspent";
    else if (percentUsed < 50) status = "underspent";
    else status = "on_track";

    return {
      ...b,
      actualSpent: Math.round(actualSpent * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      percentUsed: Math.round(percentUsed * 100) / 100,
      status,
    };
  });
}

/** Compute progress info for savings goals. O(g) where g = goals.
 *  Uses `goal.currentAmount` as the saved amount (set by the user). */
export function computeGoalProgress(
  goal: SavingsGoal,
): GoalWithProgress {
  const percentComplete =
    goal.targetAmount > 0
      ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100)
      : 0;

  let daysRemaining: number | null = null;
  let weeklyTopUp: number | null = null;

  if (goal.deadline) {
    const deadlineMs = Date.parse(goal.deadline);
    const nowMs = Date.now();
    daysRemaining = Math.max(0, Math.ceil((deadlineMs - nowMs) / (24 * 60 * 60 * 1000)));

    if (daysRemaining > 0) {
      const remaining = goal.targetAmount - goal.currentAmount;
      const weeksRemaining = Math.ceil(daysRemaining / 7);
      weeklyTopUp = Math.max(0, Math.ceil(remaining / Math.max(1, weeksRemaining)));
    }
  }

  return {
    ...goal,
    percentComplete: Math.round(percentComplete * 100) / 100,
    daysRemaining,
    weeklyTopUp,
  };
}

/** Normalize an entry's balance to BDT for aggregation.
 *  USD entries are converted using exchangeRateBdt. O(1).
 *  Reuses the shared utility from lib/domain/forex.
 *  This local wrapper handles the BalanceEntry shape specifically. */
function normalizeToBdt(e: BalanceEntry): number {
  if (e.currency === "USD" && e.exchangeRateBdt && e.exchangeRateBdt > 0) {
    return e.balance * e.exchangeRateBdt;
  }
  return e.balance;
}

/** Get the current month key as YYYY-MM. */
export function currentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
