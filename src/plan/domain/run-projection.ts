import { FundRule, MonthData, Plan } from './plan';

export function runProjection(plan: Plan, months: number = 120): MonthData[] {
  const { salary, monthlyCost, monthlyInvestment } = plan.premises;
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

    const income = salary;
    const expenses = monthlyCost;
    const rawSurplus = income - expenses;

    // Deduct fixed investment before waterfall
    const investmentDeduction = monthlyInvestment ?? 0;
    const availableSurplus = rawSurplus - investmentDeduction;

    // Waterfall allocation: only allocate if surplus is positive
    if (availableSurplus > 0) {
      allocateWaterfall(sortedFunds, fundBalances, availableSurplus);
    }

    result.push({
      month: i + 1,
      date,
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
      // Free-accumulating fund: absorbs all remaining surplus
      fundBalances[fund.fundId] = currentBalance + remaining;
      remaining = 0;
    } else {
      const gap = fund.target - currentBalance;
      if (gap <= 0) {
        // Fund is already full, overflow to next
        continue;
      }
      const allocation = Math.min(remaining, gap);
      fundBalances[fund.fundId] = currentBalance + allocation;
      remaining -= allocation;
    }
  }
}
