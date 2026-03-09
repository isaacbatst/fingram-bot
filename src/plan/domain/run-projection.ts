import { getActiveValue } from './change-point';
import { Box, MonthData, Plan } from './plan';

function getBoxOutflow(
  box: Box,
  month: number,
  currentBalance: number,
): { outflow: number; scheduledPayments: { amount: number; label: string }[] } {
  if (box.target > 0 && currentBalance >= box.target) {
    return { outflow: 0, scheduledPayments: [] };
  }

  const paymentsThisMonth = box.scheduledPayments.filter(
    (p) => p.month === month,
  );

  if (paymentsThisMonth.length > 0) {
    const scheduledTotal = paymentsThisMonth.reduce(
      (sum, p) => sum + p.amount,
      0,
    );
    const hasAdditional = paymentsThisMonth.some((p) => p.additionalToMonthly);

    let outflow = scheduledTotal;
    if (hasAdditional) {
      outflow += getActiveValue(box.monthlyAmount, month);
    }

    return {
      outflow,
      scheduledPayments: paymentsThisMonth.map((p) => ({
        amount: p.amount,
        label: p.label,
      })),
    };
  }

  let outflow = getActiveValue(box.monthlyAmount, month);

  if (box.target > 0) {
    const remaining = box.target - currentBalance;
    outflow = Math.min(outflow, remaining);
  }

  return { outflow, scheduledPayments: [] };
}

export function runProjection(plan: Plan, months?: number): MonthData[] {
  const totalMonths = months ?? 120;

  const boxBalances: Record<string, number> = {};
  for (const box of plan.boxes) {
    boxBalances[box.id] = 0;
  }

  let cash = 0;
  const result: MonthData[] = [];

  for (let i = 0; i < totalMonths; i++) {
    const date = new Date(plan.startDate);
    date.setMonth(date.getMonth() + i);

    const income = getActiveValue(plan.premises.salaryChangePoints, i);
    const costOfLiving = getActiveValue(
      plan.premises.costOfLivingChangePoints,
      i,
    );

    let boxOutflows = 0;
    const boxPayments: Record<string, number> = {};
    const monthScheduledPayments: {
      boxId: string;
      amount: number;
      label: string;
    }[] = [];

    for (const box of plan.boxes) {
      const { outflow, scheduledPayments } = getBoxOutflow(
        box,
        i,
        boxBalances[box.id],
      );

      boxBalances[box.id] += outflow;
      boxOutflows += outflow;
      boxPayments[box.id] = outflow;

      for (const sp of scheduledPayments) {
        monthScheduledPayments.push({
          boxId: box.id,
          amount: sp.amount,
          label: sp.label,
        });
      }
    }

    const surplus = income - costOfLiving - boxOutflows;
    cash += surplus;

    let totalWealth = cash;
    let totalCommitted = 0;
    for (const box of plan.boxes) {
      if (box.holdsFunds) {
        totalWealth += boxBalances[box.id];
      } else {
        totalCommitted += boxBalances[box.id];
      }
    }

    result.push({
      month: i + 1,
      date,
      income,
      costOfLiving,
      surplus,
      cash,
      boxes: { ...boxBalances },
      boxPayments,
      scheduledPayments: monthScheduledPayments,
      totalWealth,
      totalCommitted,
    });
  }

  return result;
}
