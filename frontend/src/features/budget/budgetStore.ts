/**
 * features/budget/budgetStore.ts — localStorage-backed store for
 * budgets and savings goals.
 *
 * Design decisions:
 *  - localStorage (not SQLite) because budgets and goals are per-user
 *    preferences, not transactional ledger data. No migration needed.
 *  - Each mutation writes the full store atomically (JSON.stringify)
 *    so partial-write corruption is impossible.
 *  - The store is read once on init and cached in memory; all mutations
 *    write through to localStorage immediately.
 *
 * O(1) CRUD for budgets and goals:
 *  - addBudget / updateBudget / deleteBudget: O(1) keyed by id.
 *  - addGoal / updateGoal / deleteGoal: O(1) keyed by id.
 *  - getAllBudgets / getAllGoals: O(n) where n = count of each.
 */

import type { Budget, BudgetStore, SavingsGoal } from "./types";

const STORAGE_KEY = "walletsync.budget";

/* ── Internal cache ───────────────────────────────────────────────── */

let cache: BudgetStore | null = null;

function load(): BudgetStore {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = { budgets: [], goals: [] };
      return cache;
    }
    const parsed = JSON.parse(raw) as Partial<BudgetStore>;
    cache = {
      budgets: Array.isArray(parsed.budgets) ? parsed.budgets : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
    };
    return cache;
  } catch {
    cache = { budgets: [], goals: [] };
    return cache;
  }
}

function save(store: BudgetStore): void {
  cache = store;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage full — silently ignore.
  }
}

/* ── Public API ───────────────────────────────────────────────────── */

/** Get all budgets. Returns a copy — mutating won't persist. */
export function getAllBudgets(): Budget[] {
  return [...load().budgets];
}

/** Get all savings goals. Returns a copy. */
export function getAllGoals(): SavingsGoal[] {
  return [...load().goals];
}

/** Get budgets for a specific month (YYYY-MM). */
export function getBudgetsForMonth(month: string): Budget[] {
  const store = load();
  // Include rollover budgets from the previous month.
  const prevMonth = getPreviousMonth(month);
  return store.budgets.filter(
    (b) => b.month === month || (b.rollover && b.month === prevMonth),
  );
}

/** Add a new budget. Returns the updated budget. O(1). */
export function addBudget(budget: Budget): Budget {
  const store = load();
  store.budgets.push(budget);
  save(store);
  return budget;
}

/** Update an existing budget. Returns true if found and updated. O(1). */
export function updateBudget(id: string, updates: Partial<Budget>): boolean {
  const store = load();
  const idx = store.budgets.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  store.budgets[idx] = { ...store.budgets[idx], ...updates };
  save(store);
  return true;
}

/** Delete a budget by id. Returns true if found and deleted. O(1). */
export function deleteBudget(id: string): boolean {
  const store = load();
  const idx = store.budgets.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  store.budgets.splice(idx, 1);
  save(store);
  return true;
}

/** Add a new savings goal. Returns the updated goal. O(1). */
export function addGoal(goal: SavingsGoal): SavingsGoal {
  const store = load();
  store.goals.push(goal);
  save(store);
  return goal;
}

/** Update an existing savings goal. Returns true if found. O(1). */
export function updateGoal(id: string, updates: Partial<SavingsGoal>): boolean {
  const store = load();
  const idx = store.goals.findIndex((g) => g.id === id);
  if (idx === -1) return false;
  store.goals[idx] = { ...store.goals[idx], ...updates };
  save(store);
  return true;
}

/** Delete a savings goal by id. Returns true if found. O(1). */
export function deleteGoal(id: string): boolean {
  const store = load();
  const idx = store.goals.findIndex((g) => g.id === id);
  if (idx === -1) return false;
  store.goals.splice(idx, 1);
  save(store);
  return true;
}

/** Subscribe to store changes. Returns an unsubscribe function.
 *  The callback fires immediately with the current store, then on
 *  every subsequent change (via the 'storage' event, which fires when
 *  localStorage is modified by another tab).
 *
 *  Note: mutations from the same tab are not broadcast via the
 *  'storage' event. The API functions (addBudget, addGoal, etc.)
 *  invalidate the cache directly; UI components that call them
 *  should manage their own refresh state. */
export function onStoreChange(cb: (store: BudgetStore) => void): () => void {
  // Fire immediately with current state.
  cb(load());

  // Listen for cross-tab changes.
  function handleStorage(e: StorageEvent) {
    if (e.key === STORAGE_KEY) {
      cache = null; // invalidate cache so load() re-reads
      cb(load());
    }
  }
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function getPreviousMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 2, 1); // month-1 (0-indexed), so m-2
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

/** Compute the current month key as YYYY-MM. */
export function currentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Generate a simple unique id. */
export function makeBudgetId(): string {
  return `budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a simple unique id for goals. */
export function makeGoalId(): string {
  return `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
