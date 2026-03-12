import { getActiveValue } from './change-point';
import {
  computeFinancingMonth,
  FinancingState,
  initFinancingState,
} from './financing-calculator';
import { Box, FinancingMonthDetail, MonthData, Plan } from './plan';

function getBoxOutflow(
  box: Box,
  month: number,
  currentBalance: number,
): { outflow: number; scheduledPayments: { amount: number; label: string }[] } {
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

  if (box.target > 0 && currentBalance >= box.target) {
    return { outflow: 0, scheduledPayments: [] };
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
  const financingStates: Record<string, FinancingState> = {};

  for (const box of plan.boxes) {
    boxBalances[box.id] = 0;
    if (box.financing) {
      financingStates[box.id] = initFinancingState(box.financing);
    }
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
    const boxYields: Record<string, number> = {};
    const financingDetails: Record<string, FinancingMonthDetail> = {};
    const monthScheduledPayments: {
      boxId: string;
      amount: number;
      label: string;
    }[] = [];

    // Pass 1: Process regular boxes (deposits + yields) so balances are
    // up-to-date before financing boxes reference them via sourceBoxId.
    for (const box of plan.boxes) {
      if (box.financing) continue;

      const { outflow, scheduledPayments } = getBoxOutflow(
        box,
        i,
        boxBalances[box.id],
      );

      boxBalances[box.id] += outflow;
      boxOutflows += outflow;
      boxPayments[box.id] = outflow;

      let yieldEarned = 0;
      if (
        box.holdsFunds &&
        box.yieldRate &&
        box.yieldRate > 0 &&
        boxBalances[box.id] > 0
      ) {
        const monthlyRate = box.yieldRate / 12;
        yieldEarned = boxBalances[box.id] * monthlyRate;
        boxBalances[box.id] += yieldEarned;
      }
      boxYields[box.id] = yieldEarned;

      for (const sp of scheduledPayments) {
        monthScheduledPayments.push({
          boxId: box.id,
          amount: sp.amount,
          label: sp.label,
        });
      }
    }

    // Pass 2: Process financing boxes (may deduct from source boxes).
    for (const box of plan.boxes) {
      if (!box.financing) continue;

      const scheduledThisMonth = box.scheduledPayments.filter(
        (p) => p.month === i,
      );

      // Process extra amortizations
      let extraAmortization = 0;
      for (const sp of scheduledThisMonth) {
        if (sp.sourceBoxId) {
          // Deduct from source box (direct transfer, not from cash)
          const available = boxBalances[sp.sourceBoxId] ?? 0;
          const deduction = Math.min(sp.amount, available);
          boxBalances[sp.sourceBoxId] -= deduction;
          extraAmortization += deduction;
        } else {
          // Deduct from cash via boxOutflows
          extraAmortization += sp.amount;
          boxOutflows += sp.amount;
        }
        monthScheduledPayments.push({
          boxId: box.id,
          amount: sp.amount,
          label: sp.label,
        });
      }

      const { detail, nextState } = computeFinancingMonth(
        box.financing,
        financingStates[box.id],
        i,
        extraAmortization,
      );

      financingStates[box.id] = nextState;
      financingDetails[box.id] = detail;

      // Full payment (amort + interest) comes from cash
      boxOutflows += detail.payment;
      boxPayments[box.id] = detail.payment;

      // Balance tracks amortization progress (not total paid)
      boxBalances[box.id] =
        box.financing.principal - detail.outstandingBalance;

      // No yield on financing boxes
      boxYields[box.id] = 0;
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
      boxYields: { ...boxYields },
      totalYield: Object.values(boxYields).reduce((sum, v) => sum + v, 0),
      scheduledPayments: monthScheduledPayments,
      totalWealth,
      totalCommitted,
      financingDetails,
    });
  }

  return result;
}
