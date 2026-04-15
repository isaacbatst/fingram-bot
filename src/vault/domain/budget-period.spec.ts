import { describe, it, expect } from 'vitest';
import {
  BudgetStartDaySchedule,
  getBudgetPeriod,
  getCurrentBudgetPeriod,
  getEffectiveStartDay,
  isDateInBudgetPeriod,
  validateSchedule,
} from './budget-period';

describe('getEffectiveStartDay', () => {
  it('returns defaultDay when no overrides match', () => {
    const s: BudgetStartDaySchedule = { defaultDay: 10, overrides: [] };
    expect(getEffectiveStartDay(s, 2026, 4)).toBe(10);
  });

  it('returns override day for exact (year, month) match', () => {
    const s: BudgetStartDaySchedule = {
      defaultDay: 10,
      overrides: [{ year: 2026, month: 4, day: 18 }],
    };
    expect(getEffectiveStartDay(s, 2026, 4)).toBe(18);
    expect(getEffectiveStartDay(s, 2026, 5)).toBe(10);
    expect(getEffectiveStartDay(s, 2025, 4)).toBe(10);
  });
});

describe('getBudgetPeriod', () => {
  it('standard case without overrides (UTC)', () => {
    const s: BudgetStartDaySchedule = { defaultDay: 10, overrides: [] };
    const { startDate, endDate } = getBudgetPeriod(s, 2026, 3);
    expect(startDate.getTime()).toBe(Date.UTC(2026, 2, 10));
    expect(endDate.getTime()).toBe(Date.UTC(2026, 3, 9, 23, 59, 59, 999));
  });

  it('December crosses into January of next year', () => {
    const s: BudgetStartDaySchedule = { defaultDay: 5, overrides: [] };
    const { startDate, endDate } = getBudgetPeriod(s, 2026, 12);
    expect(startDate.getTime()).toBe(Date.UTC(2026, 11, 5));
    expect(endDate.getTime()).toBe(Date.UTC(2027, 0, 4, 23, 59, 59, 999));
  });

  it('defaultDay=1: endDate is last day of current month', () => {
    const s: BudgetStartDaySchedule = { defaultDay: 1, overrides: [] };
    const { startDate, endDate } = getBudgetPeriod(s, 2026, 3);
    expect(startDate.getTime()).toBe(Date.UTC(2026, 2, 1));
    // Date.UTC(2026, 3, 0) = last day of March (31st)
    expect(endDate.getTime()).toBe(Date.UTC(2026, 3, 0, 23, 59, 59, 999));
  });

  it('override on next month shortens current period', () => {
    const s: BudgetStartDaySchedule = {
      defaultDay: 20,
      overrides: [{ year: 2026, month: 4, day: 18 }],
    };
    const { startDate, endDate } = getBudgetPeriod(s, 2026, 3);
    expect(startDate.getTime()).toBe(Date.UTC(2026, 2, 20));
    expect(endDate.getTime()).toBe(Date.UTC(2026, 3, 17, 23, 59, 59, 999));
  });

  it('override on January affects December of previous year', () => {
    const s: BudgetStartDaySchedule = {
      defaultDay: 10,
      overrides: [{ year: 2027, month: 1, day: 3 }],
    };
    const { endDate } = getBudgetPeriod(s, 2026, 12);
    expect(endDate.getTime()).toBe(Date.UTC(2027, 0, 2, 23, 59, 59, 999));
  });
});

describe('isDateInBudgetPeriod', () => {
  it('includes startDate and endDate boundaries', () => {
    const s: BudgetStartDaySchedule = { defaultDay: 10, overrides: [] };
    const start = new Date(Date.UTC(2026, 2, 10));
    const end = new Date(Date.UTC(2026, 3, 9, 23, 59, 59, 999));
    const middle = new Date(Date.UTC(2026, 2, 20));
    const before = new Date(Date.UTC(2026, 2, 9, 23, 59, 59, 999));
    const after = new Date(Date.UTC(2026, 3, 10));
    expect(isDateInBudgetPeriod(s, start, 2026, 3)).toBe(true);
    expect(isDateInBudgetPeriod(s, end, 2026, 3)).toBe(true);
    expect(isDateInBudgetPeriod(s, middle, 2026, 3)).toBe(true);
    expect(isDateInBudgetPeriod(s, before, 2026, 3)).toBe(false);
    expect(isDateInBudgetPeriod(s, after, 2026, 3)).toBe(false);
  });
});

describe('getCurrentBudgetPeriod', () => {
  it('now after startDay → current calendar month', () => {
    const s: BudgetStartDaySchedule = { defaultDay: 10, overrides: [] };
    const now = new Date(Date.UTC(2026, 3, 15));
    expect(getCurrentBudgetPeriod(s, now)).toEqual({ year: 2026, month: 4 });
  });

  it('now before startDay → previous calendar month', () => {
    const s: BudgetStartDaySchedule = { defaultDay: 10, overrides: [] };
    const now = new Date(Date.UTC(2026, 3, 5));
    expect(getCurrentBudgetPeriod(s, now)).toEqual({ year: 2026, month: 3 });
  });

  it('January before defaultDay → December of previous year', () => {
    const s: BudgetStartDaySchedule = { defaultDay: 10, overrides: [] };
    const now = new Date(Date.UTC(2026, 0, 3));
    expect(getCurrentBudgetPeriod(s, now)).toEqual({ year: 2025, month: 12 });
  });

  it('override shifts boundary: April override day=18, now=April 15 → still March', () => {
    const s: BudgetStartDaySchedule = {
      defaultDay: 10,
      overrides: [{ year: 2026, month: 4, day: 18 }],
    };
    const now = new Date(Date.UTC(2026, 3, 15));
    expect(getCurrentBudgetPeriod(s, now)).toEqual({ year: 2026, month: 3 });
  });

  it('override shifts boundary: April override day=18, now=April 19 → April', () => {
    const s: BudgetStartDaySchedule = {
      defaultDay: 10,
      overrides: [{ year: 2026, month: 4, day: 18 }],
    };
    const now = new Date(Date.UTC(2026, 3, 19));
    expect(getCurrentBudgetPeriod(s, now)).toEqual({ year: 2026, month: 4 });
  });
});

describe('validateSchedule', () => {
  it('accepts a valid schedule', () => {
    const [err, schedule] = validateSchedule({
      defaultDay: 10,
      overrides: [{ year: 2026, month: 4, day: 18 }],
    });
    expect(err).toBeNull();
    expect(schedule).toEqual({
      defaultDay: 10,
      overrides: [{ year: 2026, month: 4, day: 18 }],
    });
  });

  it('rejects defaultDay out of range', () => {
    const [err1] = validateSchedule({ defaultDay: 0, overrides: [] });
    const [err2] = validateSchedule({ defaultDay: 29, overrides: [] });
    expect(err1).not.toBeNull();
    expect(err2).not.toBeNull();
  });

  it('rejects override day out of range', () => {
    const [err] = validateSchedule({
      defaultDay: 10,
      overrides: [{ year: 2026, month: 4, day: 29 }],
    });
    expect(err).not.toBeNull();
  });

  it('rejects duplicate (year, month) overrides', () => {
    const [err] = validateSchedule({
      defaultDay: 10,
      overrides: [
        { year: 2026, month: 4, day: 18 },
        { year: 2026, month: 4, day: 20 },
      ],
    });
    expect(err).not.toBeNull();
  });

  it('rejects non-integer values', () => {
    const [err] = validateSchedule({
      defaultDay: 10,
      overrides: [{ year: 2026, month: 4, day: 18.5 }],
    });
    expect(err).not.toBeNull();
  });
});
