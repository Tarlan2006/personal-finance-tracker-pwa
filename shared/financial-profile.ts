export interface FinancialAccount {
  id: string; bank: string; name: string; kind: 'card' | 'deposit' | 'account' | 'cash';
  openingBalanceMinor: number | null;
}
export interface IncomeSource { id: string; name: string; categoryId: string; monthlyMinor: number | null; regular: boolean }
export interface Obligation { id: string; name: string; monthlyMinor: number | null; debtMinor: number | null }
export interface FinancialProfile {
  balanceDate: string;
  accounts: FinancialAccount[];
  expenseCategoryIds: string[];
  monthlyBudgetMinor: number | null;
  incomes: IncomeSource[];
  obligations: Obligation[];
  householdSize: number;
  goal: string;
  goalTargetMinor: number | null;
  monthlySavingMinor: number | null;
}
export interface FinancialProfileRecord {
  status: 'new' | 'draft' | 'complete' | 'deferred';
  version: number;
  profile: FinancialProfile | null;
  updatedAt: number | null;
}
