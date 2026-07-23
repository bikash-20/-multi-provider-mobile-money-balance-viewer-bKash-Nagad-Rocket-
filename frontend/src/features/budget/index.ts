/**
 * features/budget — Budget Planner & Savings Goals.
 */
export { BudgetDashboard } from "./BudgetDashboard";
export { AddBudgetDialog } from "./AddBudgetDialog";
export { AddGoalDialog } from "./AddGoalDialog";
export {
  getAllBudgets,
  getAllGoals,
  addBudget,
  updateBudget,
  deleteBudget,
  addGoal,
  updateGoal,
  deleteGoal,
  currentMonthKey,
} from "./budgetStore";
export { computeMonthlySpending, computeBudgetWithActuals, computeGoalProgress } from "./computeSpending";
export type { Budget, SavingsGoal, BudgetStore, BudgetWithActual, GoalWithProgress, MonthlySpending } from "./types";
