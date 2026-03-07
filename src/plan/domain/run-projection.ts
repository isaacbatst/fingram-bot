import { FundRule, MonthData, Phase, Plan } from './plan';

function getPhaseForMonth(month: number, phases: Phase[]): Phase | undefined {
  return phases.find((p) => month >= p.startMonth && month <= p.endMonth);
}

export function runProjection(plan: Plan, months: number = 120): MonthData[] {
  const { salary, monthlyInvestment } = plan.premises;
  const sortedFunds = [...plan.fundAllocation].sort(
    (a, b) => a.priority - b.priority,
  );

  const fundBalances: Record<string, number> = {};
  for (const fund of sortedFunds) {
    fundBalances[fund.fundId] = 0;
  }

  const result: MonthData[] = [];

  for (let i = 0; i < months; i++) {
    const date = new Date(plan.startDate);
    date.setMonth(date.getMonth() + i);

    const currentPhase = getPhaseForMonth(i, plan.phases);
    const income = salary;
    const expenses = currentPhase?.monthlyCost ?? 0;
    const rawSurplus = income - expenses;

    const investmentDeduction = monthlyInvestment ?? 0;
    const availableSurplus = rawSurplus - investmentDeduction;

    if (availableSurplus > 0) {
      allocateWaterfall(sortedFunds, fundBalances, availableSurplus);
    }

    result.push({
      month: i + 1,
      date,
      phase: currentPhase?.id ?? '',
      income,
      expenses,
      surplus: rawSurplus,
      funds: { ...fundBalances },
    });
  }

  return result;
}

function allocateWaterfall(
  sortedFunds: FundRule[],
  fundBalances: Record<string, number>,
  availableSurplus: number,
): void {
  let remaining = availableSurplus;

  for (const fund of sortedFunds) {
    if (remaining <= 0) break;

    const currentBalance = fundBalances[fund.fundId];
    const isFreeAccumulating = fund.target === 0;

    if (isFreeAccumulating) {
      fundBalances[fund.fundId] = currentBalance + remaining;
      remaining = 0;
    } else {
      const gap = fund.target - currentBalance;
      if (gap <= 0) {
        continue;
      }
      const allocation = Math.min(remaining, gap);
      fundBalances[fund.fundId] = currentBalance + allocation;
      remaining -= allocation;
    }
  }
}
