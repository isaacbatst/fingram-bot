export type BreakdownTransaction = {
  amount: number;
  type: 'income' | 'expense';
  date: Date;
  categoryId: string | null;
  boxId: string;
  transferId: string | null;
  allocationId: string | null;
};

export type BreakdownGroupBy = 'category' | 'month' | 'categoryAndMonth';

export type BreakdownGroup = {
  categoryId?: string | null;
  categoryName?: string;
  /** Budget period (the month the period starts in). */
  period?: { month: number; year: number };
  total: number;
  count: number;
};

export type SpendingBreakdown = {
  total: number;
  count: number;
  groups: BreakdownGroup[];
};

export const PLANNED_PAYMENTS_LABEL = 'Pagamentos do plano';
export const UNCATEGORIZED_LABEL = 'Sem categoria';

/**
 * Totals of income or expense over a date range, grouped by category and/or
 * budget period. Follows the per-category budget semantics of the app:
 * transfers between boxes are never counted, and planned payments
 * (transactions tied to a plan allocation) form their own group instead of
 * inflating a category. Amounts are rounded to cents only at the end.
 */
export function computeSpendingBreakdown(input: {
  transactions: Iterable<BreakdownTransaction>;
  range: { startDate: Date; endDate: Date };
  type: 'income' | 'expense';
  groupBy: BreakdownGroupBy;
  boxId?: string;
  categoryNames: Map<string, string>;
  periodOf: (date: Date) => { month: number; year: number };
}): SpendingBreakdown {
  const groups = new Map<string, BreakdownGroup>();
  let total = 0;
  let count = 0;

  for (const t of input.transactions) {
    if (t.type !== input.type || t.transferId) continue;
    if (t.date < input.range.startDate || t.date > input.range.endDate) {
      continue;
    }
    if (input.boxId && t.boxId !== input.boxId) continue;

    const group: Omit<BreakdownGroup, 'total' | 'count'> = {};
    const keyParts: string[] = [];

    if (input.groupBy !== 'month') {
      if (t.allocationId) {
        group.categoryId = null;
        group.categoryName = PLANNED_PAYMENTS_LABEL;
        keyParts.push('allocation');
      } else if (t.categoryId) {
        group.categoryId = t.categoryId;
        group.categoryName =
          input.categoryNames.get(t.categoryId) ?? UNCATEGORIZED_LABEL;
        keyParts.push(`category:${t.categoryId}`);
      } else {
        group.categoryId = null;
        group.categoryName = UNCATEGORIZED_LABEL;
        keyParts.push('uncategorized');
      }
    }

    if (input.groupBy !== 'category') {
      const period = input.periodOf(t.date);
      group.period = period;
      keyParts.push(`period:${period.year}-${period.month}`);
    }

    const key = keyParts.join('|');
    const current = groups.get(key) ?? { ...group, total: 0, count: 0 };
    current.total += t.amount;
    current.count += 1;
    groups.set(key, current);
    total += t.amount;
    count += 1;
  }

  const sorted = [...groups.values()].map((g) => ({
    ...g,
    total: round(g.total),
  }));
  sorted.sort((a, b) => {
    if (a.period && b.period) {
      const byPeriod =
        a.period.year - b.period.year || a.period.month - b.period.month;
      if (byPeriod !== 0) return byPeriod;
    }
    return b.total - a.total;
  });

  return { total: round(total), count, groups: sorted };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
