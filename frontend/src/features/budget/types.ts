/**
 * features/budget/types.ts — Types for the Budget Planner & Savings Goals.
 *
 * These types are shared between the localStorage store and UI components.
 * No server-only imports (better-sqlite3, node:*) in this file.
 */

/** A monthly budget target. */
export interface Budget {
  id: string;
  name: string;
  /** Monthly spending limit in BDT. */
  amount: number;
  /** Category label for grouping (e.g., "Food", "Transport", "Entertainment"). */
  category: string;
  /** Budget period in YYYY-MM format. */
  month: string;
  /** Whether unspent amount rolls over to the next month. */
  rollover: boolean;
  /** ISO date string when this budget was created. */
  createdAt: string;
}

/** A savings goal with a target amount and deadline. */
export interface SavingsGoal {
  id: string;
  name: string;
  description: string;
  /** Target amount to save in BDT. */
  targetAmount: number;
  /** Current amount saved in BDT. */
  currentAmount: number;
  /** Optional deadline ISO date (YYYY-MM-DD). Null means no deadline. */
  deadline: string | null;
  /** ISO date string when this goal was created. */
  createdAt: string;
}

/** The shape stored in localStorage under `walletsync.budget`. */
export interface BudgetStore {
  budgets: Budget[];
  goals: SavingsGoal[];
}

/** Monthly spending summary derived from balance entries. */
export interface MonthlySpending {
  month: string; // YYYY-MM
  /** Total outflows (negative balance changes) in BDT. */
  totalSpent: number;
  /** Total inflows (positive balance changes) in BDT. */
  totalIncome: number;
  /** Net change (income - spending). */
  netChange: number;
}

/** A budget with its computed actual spending attached. */
export interface BudgetWithActual extends Budget {
  actualSpent: number;
  remaining: number;
  percentUsed: number;
  status: "on_track" | "overspent" | "underspent";
}

/** A savings goal with computed progress info. */
export interface GoalWithProgress extends SavingsGoal {
  percentComplete: number;
  /** Days remaining until deadline (null if no deadline). */
  daysRemaining: number | null;
  /** Suggested weekly top-up to meet the deadline. */
  weeklyTopUp: number | null;
}
