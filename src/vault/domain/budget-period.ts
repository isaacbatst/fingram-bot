import { Either, left, right } from './either';

export type BudgetStartDayOverride = {
  year: number;
  month: number; // 1-12
  day: number; // 1-28
};

export type BudgetStartDaySchedule = {
  defaultDay: number; // 1-28
  overrides: BudgetStartDayOverride[];
};

export function getEffectiveStartDay(
  schedule: BudgetStartDaySchedule,
  year: number,
  month: number,
): number {
  const override = schedule.overrides.find(
    (o) => o.year === year && o.month === month,
  );
  return override ? override.day : schedule.defaultDay;
}

/**
 * Returns the UTC start/end of the budget period semantically labeled (year, month).
 * endDate is 23:59:59.999 UTC of the day before the next period's start.
 * Relies on Date.UTC day-0 rollover: Date.UTC(y, m-1, 0) === last day of month m-2.
 */
export function getBudgetPeriod(
  schedule: BudgetStartDaySchedule,
  year: number,
  month: number,
): { startDate: Date; endDate: Date } {
  const startDay = getEffectiveStartDay(schedule, year, month);
  const startDate = new Date(Date.UTC(year, month - 1, startDay));

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextStartDay = getEffectiveStartDay(schedule, nextYear, nextMonth);

  const endDate = new Date(
    Date.UTC(nextYear, nextMonth - 1, nextStartDay - 1, 23, 59, 59, 999),
  );

  return { startDate, endDate };
}

export function isDateInBudgetPeriod(
  schedule: BudgetStartDaySchedule,
  date: Date,
  year: number,
  month: number,
): boolean {
  const { startDate, endDate } = getBudgetPeriod(schedule, year, month);
  const t = date.getTime();
  return t >= startDate.getTime() && t <= endDate.getTime();
}

/**
 * Returns the semantic (year, month) of the accounting period containing `now`.
 * With variable-length periods, cannot shortcut via `now.day < defaultDay` —
 * must compare against the actual startDate of the candidate month.
 */
export function getCurrentBudgetPeriod(
  schedule: BudgetStartDaySchedule,
  now: Date = new Date(),
): { month: number; year: number } {
  const candidateYear = now.getUTCFullYear();
  const candidateMonth = now.getUTCMonth() + 1;

  const { startDate } = getBudgetPeriod(
    schedule,
    candidateYear,
    candidateMonth,
  );
  if (now.getTime() >= startDate.getTime()) {
    return { year: candidateYear, month: candidateMonth };
  }

  if (candidateMonth === 1) {
    return { year: candidateYear - 1, month: 12 };
  }
  return { year: candidateYear, month: candidateMonth - 1 };
}

export function validateSchedule(
  input: unknown,
): Either<string, BudgetStartDaySchedule> {
  if (!input || typeof input !== 'object') {
    return left('Configuração inválida');
  }
  const obj = input as Record<string, unknown>;

  if (
    !Number.isInteger(obj.defaultDay) ||
    (obj.defaultDay as number) < 1 ||
    (obj.defaultDay as number) > 28
  ) {
    return left('O dia padrão deve ser um número inteiro entre 1 e 28');
  }

  if (!Array.isArray(obj.overrides)) {
    return left('Exceções devem ser uma lista');
  }

  const overrides: BudgetStartDayOverride[] = [];
  const seen = new Set<string>();
  for (const raw of obj.overrides) {
    if (!raw || typeof raw !== 'object') {
      return left('Exceção inválida');
    }
    const o = raw as Record<string, unknown>;
    if (!Number.isInteger(o.year) || (o.year as number) < 1970) {
      return left('Exceção: ano inválido');
    }
    if (
      !Number.isInteger(o.month) ||
      (o.month as number) < 1 ||
      (o.month as number) > 12
    ) {
      return left('Exceção: mês deve ser entre 1 e 12');
    }
    if (
      !Number.isInteger(o.day) ||
      (o.day as number) < 1 ||
      (o.day as number) > 28
    ) {
      return left('Exceção: dia deve ser entre 1 e 28');
    }
    const key = `${o.year as number}-${o.month as number}`;
    if (seen.has(key)) {
      return left(
        `Exceção duplicada para o mês ${o.month as number}/${o.year as number}`,
      );
    }
    seen.add(key);
    overrides.push({
      year: o.year as number,
      month: o.month as number,
      day: o.day as number,
    });
  }

  return right({
    defaultDay: obj.defaultDay as number,
    overrides,
  });
}
