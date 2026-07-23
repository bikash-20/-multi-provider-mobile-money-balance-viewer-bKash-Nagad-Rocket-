"use client";
/**
 * BudgetDashboard — Combined budget planner and savings goals section.
 *
 * Sections:
 *  1. Budgets — Monthly spending limits with progress bars
 *  2. Savings Goals — Target amounts with deadlines and progress
 *
 * Each section has an "Add" button and inline delete. Budgets show
 * their actual spending vs. target; goals show percent complete and
 * suggested weekly top-up.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatBDT } from "@/lib/time";
import {
  getAllBudgets,
  getAllGoals,
  deleteBudget,
  deleteGoal,
  currentMonthKey,
} from "./budgetStore";
import { computeMonthlySpending, computeBudgetWithActuals, computeGoalProgress } from "./computeSpending";
import { AddBudgetDialog } from "./AddBudgetDialog";
import { AddGoalDialog } from "./AddGoalDialog";
import type { BalanceEntry } from "@/features/wallet/types";
import type { BudgetWithActual, GoalWithProgress } from "./types";

interface BudgetDashboardProps {
  entries: BalanceEntry[];
}

export function BudgetDashboard({ entries }: BudgetDashboardProps) {
  const [showAddBudget, setShowAddBudget] = useState(false);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Budgets with actual spending computed.
  const budgetsWithActuals = useMemo(() => {
    const month = currentMonthKey();
    const budgets = getAllBudgets();
    const spending = computeMonthlySpending(entries, month);
    return computeBudgetWithActuals(budgets, spending);
  }, [entries, refreshKey]);

  // Savings goals with progress computed.
  const goalsWithProgress = useMemo(() => {
    return getAllGoals().map((g) => computeGoalProgress(g));
  }, [refreshKey]);

  const hasBudgets = budgetsWithActuals.length > 0;
  const hasGoals = goalsWithProgress.length > 0;

  if (!hasBudgets && !hasGoals) {
    return (
      <section className="rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="eyebrow">Budget Planner</span>
        </div>
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mb-3 opacity-50">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <p className="text-sm font-medium text-muted">No budgets or savings goals yet.</p>
          <p className="mt-1 text-[11px] text-muted">Create a budget to track monthly spending, or set a savings goal to work toward.</p>
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => setShowAddBudget(true)} className="rounded-md bg-signal px-3 py-1.5 text-xs font-semibold text-ink transition hover:opacity-90">
              Add Budget
            </button>
            <button type="button" onClick={() => setShowAddGoal(true)} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-signal">
              Add Goal
            </button>
          </div>
        </div>

        {showAddBudget && <AddBudgetDialog onClose={() => setShowAddBudget(false)} onCreated={triggerRefresh} />}
        {showAddGoal && <AddGoalDialog onClose={() => setShowAddGoal(false)} onCreated={triggerRefresh} />}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="eyebrow">Budget Planner</span>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setShowAddGoal(true)} className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[10px] font-semibold text-ink transition hover:border-signal">
            + Goal
          </button>
          <button type="button" onClick={() => setShowAddBudget(true)} className="rounded-md bg-signal px-2 py-1 text-[10px] font-semibold text-ink transition hover:opacity-90">
            + Budget
          </button>
        </div>
      </div>

      <div className="divide-y divide-border">
        {/* Budgets */}
        {budgetsWithActuals.map((b) => (
          <BudgetRow key={b.id} budget={b} onDelete={() => { deleteBudget(b.id); triggerRefresh(); }} />
        ))}

        {/* Savings Goals */}
        {goalsWithProgress.map((g) => (
          <GoalRow key={g.id} goal={g} onDelete={() => { deleteGoal(g.id); triggerRefresh(); }} />
        ))}
      </div>

      {showAddBudget && <AddBudgetDialog onClose={() => setShowAddBudget(false)} onCreated={triggerRefresh} />}
      {showAddGoal && <AddGoalDialog onClose={() => setShowAddGoal(false)} onCreated={triggerRefresh} />}
    </section>
  );
}

/* ── Budget Row ───────────────────────────────────────────────────── */

function BudgetRow({ budget, onDelete }: { budget: BudgetWithActual; onDelete: () => void }) {
  const { name, amount, actualSpent, percentUsed, status, category } = budget;

  const statusColor =
    status === "overspent" ? "#E0447A" : status === "on_track" ? "var(--color-signal)" : "var(--color-muted)";
  const statusLabel = status === "overspent" ? "Overspent" : status === "on_track" ? "On track" : "Under budget";

  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-ink">{name}</span>
            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">{category}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="num text-xs text-ink">{formatBDT(actualSpent)}</span>
            <span className="text-[10px] text-muted">/ {formatBDT(amount)}</span>
            <span className="num text-[10px] font-semibold" style={{ color: statusColor }}>
              {percentUsed.toFixed(0)}%
            </span>
            <span className="text-[10px]" style={{ color: statusColor }}>{statusLabel}</span>
          </div>
        </div>
        <button type="button" onClick={onDelete} aria-label={`Delete ${name} budget`} className="flex-none rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-bkash">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--color-surface-2)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, percentUsed)}%`,
            background: percentUsed > 100
              ? "#E0447A"
              : percentUsed > 80
                ? "var(--color-signal)"
                : "var(--color-signal)",
            opacity: percentUsed > 100 ? 0.8 : 0.6,
          }}
        />
      </div>
    </div>
  );
}

/* ── Goal Row ─────────────────────────────────────────────────────── */

function GoalRow({ goal, onDelete }: { goal: GoalWithProgress; onDelete: () => void }) {
  const { name, description, targetAmount, percentComplete, daysRemaining, weeklyTopUp } = goal;

  const isComplete = percentComplete >= 100;
  const urgent = daysRemaining !== null && daysRemaining <= 30 && !isComplete;

  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-ink">{name}</span>
            {isComplete && (
              <span className="rounded-full bg-signal-soft px-1.5 py-0.5 text-[9px] font-semibold text-signal">Complete!</span>
            )}
            {urgent && (
              <span className="rounded-full bg-bkash/10 px-1.5 py-0.5 text-[9px] font-semibold" style={{ color: "#E0447A" }}>
                {daysRemaining} days left
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 truncate text-[10px] text-muted">{description}</p>
          )}
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="num text-xs text-ink">{formatBDT(goal.currentAmount)}</span>
            <span className="text-[10px] text-muted">/ {formatBDT(targetAmount)}</span>
            <span className="num text-[10px] font-semibold" style={{ color: isComplete ? "var(--color-signal)" : "var(--color-muted)" }}>
              {percentComplete.toFixed(0)}%
            </span>
            {weeklyTopUp != null && !isComplete && (
              <span className="text-[10px] text-muted">
                Save {formatBDT(weeklyTopUp)}/week
              </span>
            )}
          </div>
        </div>
        <button type="button" onClick={onDelete} aria-label={`Delete ${name} goal`} className="flex-none rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-bkash">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--color-surface-2)" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(100, percentComplete)}%`,
            background: isComplete
              ? "var(--color-signal)"
              : "var(--color-border)",
            opacity: isComplete ? 0.7 : 0.5,
          }}
        />
      </div>
    </div>
  );
}
