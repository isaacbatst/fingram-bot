import { describe, expect, it } from 'vitest';
import {
  BreakdownTransaction,
  computeSpendingBreakdown,
  PLANNED_PAYMENTS_LABEL,
  UNCATEGORIZED_LABEL,
} from './spending-breakdown';

const range = {
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: new Date('2026-03-31T23:59:59.999Z'),
};
const categoryNames = new Map([
  ['food', 'Alimentação'],
  ['transport', 'Transporte'],
]);
// Calendar months, enough to exercise grouping.
const periodOf = (date: Date) => ({
  month: date.getUTCMonth() + 1,
  year: date.getUTCFullYear(),
});

function tx(
  overrides: Partial<BreakdownTransaction> & { amount: number; date: string },
): BreakdownTransaction {
  return {
    type: 'expense',
    categoryId: null,
    boxId: 'main',
    transferId: null,
    allocationId: null,
    ...overrides,
    date: new Date(overrides.date),
  };
}

function breakdown(
  transactions: BreakdownTransaction[],
  opts: Partial<Parameters<typeof computeSpendingBreakdown>[0]> = {},
) {
  return computeSpendingBreakdown({
    transactions,
    range,
    type: 'expense',
    groupBy: 'category',
    categoryNames,
    periodOf,
    ...opts,
  });
}

describe('computeSpendingBreakdown', () => {
  it('groups expenses by category, largest first', () => {
    const result = breakdown([
      tx({ amount: 10, date: '2026-01-05', categoryId: 'food' }),
      tx({ amount: 25.5, date: '2026-02-05', categoryId: 'food' }),
      tx({ amount: 50, date: '2026-01-10', categoryId: 'transport' }),
    ]);
    expect(result.total).toBe(85.5);
    expect(result.count).toBe(3);
    expect(result.groups).toEqual([
      {
        categoryId: 'transport',
        categoryName: 'Transporte',
        total: 50,
        count: 1,
      },
      {
        categoryId: 'food',
        categoryName: 'Alimentação',
        total: 35.5,
        count: 2,
      },
    ]);
  });

  it('never counts transfers, and ignores the other type', () => {
    const result = breakdown([
      tx({ amount: 100, date: '2026-01-05', transferId: 't1' }),
      tx({ amount: 300, date: '2026-01-05', type: 'income' }),
      tx({ amount: 7, date: '2026-01-05', categoryId: 'food' }),
    ]);
    expect(result.total).toBe(7);
    expect(result.count).toBe(1);
  });

  it('puts planned payments and uncategorized in their own groups', () => {
    const result = breakdown([
      tx({ amount: 1200, date: '2026-01-05', allocationId: 'a1' }),
      tx({ amount: 20, date: '2026-01-06' }),
    ]);
    expect(result.groups).toEqual([
      {
        categoryId: null,
        categoryName: PLANNED_PAYMENTS_LABEL,
        total: 1200,
        count: 1,
      },
      {
        categoryId: null,
        categoryName: UNCATEGORIZED_LABEL,
        total: 20,
        count: 1,
      },
    ]);
  });

  it('respects the range bounds inclusively', () => {
    const result = breakdown([
      tx({ amount: 1, date: '2025-12-31T23:59:59.999Z' }),
      tx({ amount: 2, date: '2026-01-01T00:00:00.000Z' }),
      tx({ amount: 4, date: '2026-03-31T23:59:59.999Z' }),
      tx({ amount: 8, date: '2026-04-01T00:00:00.000Z' }),
    ]);
    expect(result.total).toBe(6);
  });

  it('filters by box', () => {
    const result = breakdown(
      [
        tx({ amount: 5, date: '2026-01-05', boxId: 'nubank' }),
        tx({ amount: 9, date: '2026-01-05', boxId: 'main' }),
      ],
      { boxId: 'nubank' },
    );
    expect(result.total).toBe(5);
  });

  it('groups by period in chronological order', () => {
    const result = breakdown(
      [
        tx({ amount: 30, date: '2026-02-10', categoryId: 'food' }),
        tx({ amount: 10, date: '2026-01-10', categoryId: 'food' }),
        tx({ amount: 5, date: '2026-01-20', categoryId: 'transport' }),
      ],
      { groupBy: 'month' },
    );
    expect(result.groups).toEqual([
      { period: { month: 1, year: 2026 }, total: 15, count: 2 },
      { period: { month: 2, year: 2026 }, total: 30, count: 1 },
    ]);
  });

  it('groups by category and period', () => {
    const result = breakdown(
      [
        tx({ amount: 10, date: '2026-01-10', categoryId: 'food' }),
        tx({ amount: 5, date: '2026-01-20', categoryId: 'transport' }),
        tx({ amount: 30, date: '2026-02-10', categoryId: 'food' }),
      ],
      { groupBy: 'categoryAndMonth' },
    );
    expect(result.groups).toEqual([
      {
        categoryId: 'food',
        categoryName: 'Alimentação',
        period: { month: 1, year: 2026 },
        total: 10,
        count: 1,
      },
      {
        categoryId: 'transport',
        categoryName: 'Transporte',
        period: { month: 1, year: 2026 },
        total: 5,
        count: 1,
      },
      {
        categoryId: 'food',
        categoryName: 'Alimentação',
        period: { month: 2, year: 2026 },
        total: 30,
        count: 1,
      },
    ]);
  });

  it('sums income when asked', () => {
    const result = breakdown(
      [
        tx({ amount: 5000, date: '2026-01-05', type: 'income' }),
        tx({ amount: 50, date: '2026-01-05' }),
      ],
      { type: 'income' },
    );
    expect(result.total).toBe(5000);
  });

  it('avoids float drift in totals', () => {
    const result = breakdown([
      tx({ amount: 0.1, date: '2026-01-05' }),
      tx({ amount: 0.2, date: '2026-01-05' }),
    ]);
    expect(result.total).toBe(0.3);
  });
});
