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
): {
  outflow: number;
  scheduledMovements: { amount: number; label: string }[];
} {
  const paymentsThisMonth = (box.scheduledMovements ?? []).filter(
    (p) => p.month === month && p.type === 'in',
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
      scheduledMovements: paymentsThisMonth.map((p) => ({
        amount: p.amount,
        label: p.label,
      })),
    };
  }

  if (box.target > 0 && currentBalance >= box.target) {
    return { outflow: 0, scheduledMovements: [] };
  }

  let outflow = getActiveValue(box.monthlyAmount, month);

  if (box.target > 0) {
    const remaining = box.target - currentBalance;
    outflow = Math.min(outflow, remaining);
  }

  return { outflow, scheduledMovements: [] };
}

export function runProjection(plan: Plan, months?: number): MonthData[] {
  const totalMonths = months ?? 120;

  const boxBalances: Record<string, number> = {};
  const financingStates: Record<string, FinancingState> = {};

  for (const box of plan.boxes) {
    boxBalances[box.id] = box.initialBalance ?? 0;
    if (box.financing) {
      financingStates[box.id] = initFinancingState(box.financing);
    }
  }

  let cash = 0;
  const result: MonthData[] = [];

  for (let i = 0; i < totalMonths; i++) {
    const start = new Date(plan.startDate);
    const date = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1),
    );

    const income = getActiveValue(plan.premises.salaryChangePoints, i);
    const costOfLiving = getActiveValue(
      plan.premises.costOfLivingChangePoints,
      i,
    );

    let boxOutflows = 0;
    const boxPayments: Record<string, number> = {};
    const boxYields: Record<string, number> = {};
    const financingDetails: Record<string, FinancingMonthDetail> = {};
    const monthScheduledMovements: {
      boxId: string;
      amount: number;
      label: string;
      type: 'in' | 'out';
      destinationBoxId?: string;
    }[] = [];
    const extraAmortizations: Record<string, number> = {};

    // Pass 1: Process regular boxes (deposits + yields) so balances are
    // up-to-date before financing boxes reference them.
    for (const box of plan.boxes) {
      if (box.financing) continue;

      const { outflow, scheduledMovements: inMovements } = getBoxOutflow(
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

      for (const sp of inMovements) {
        monthScheduledMovements.push({
          boxId: box.id,
          amount: sp.amount,
          label: sp.label,
          type: 'in',
        });
      }

      // Process 'out' movements for this box
      const outsThisMonth = (box.scheduledMovements ?? []).filter(
        (p) => p.month === i && p.type === 'out',
      );

      for (const out of outsThisMonth) {
        const available = boxBalances[box.id] ?? 0;
        const deduction = Math.min(out.amount, available);
        boxBalances[box.id] -= deduction;

        if (out.destinationBoxId) {
          const destBox = plan.boxes.find((b) => b.id === out.destinationBoxId);
          if (destBox?.financing) {
            extraAmortizations[out.destinationBoxId] =
              (extraAmortizations[out.destinationBoxId] ?? 0) + deduction;
          } else {
            boxBalances[out.destinationBoxId] =
              (boxBalances[out.destinationBoxId] ?? 0) + deduction;
          }
        } else {
          boxOutflows -= deduction;
        }

        monthScheduledMovements.push({
          boxId: box.id,
          amount: deduction,
          label: out.label,
          type: 'out',
          destinationBoxId: out.destinationBoxId,
        });
      }
    }

    // Pass 2: Process financing boxes (may deduct from source boxes).
    for (const box of plan.boxes) {
      if (!box.financing) continue;

      const financingStart = box.financing.startMonth ?? 0;

      // Before financing starts, no payments
      if (i < financingStart) {
        boxPayments[box.id] = 0;
        boxYields[box.id] = 0;
        continue;
      }

      const financingMonth = i - financingStart;

      // Process 'in' movements on financing box as extra amortization from cash
      const financingInsThisMonth = (box.scheduledMovements ?? []).filter(
        (p) => p.month === i && p.type === 'in',
      );

      let extraAmortization = extraAmortizations[box.id] ?? 0;
      for (const sp of financingInsThisMonth) {
        extraAmortization += sp.amount;
        boxOutflows += sp.amount;
        monthScheduledMovements.push({
          boxId: box.id,
          amount: sp.amount,
          label: sp.label,
          type: 'in',
        });
      }

      const { detail, nextState } = computeFinancingMonth(
        box.financing,
        financingStates[box.id],
        financingMonth,
        extraAmortization,
      );

      financingStates[box.id] = nextState;
      financingDetails[box.id] = detail;

      // Full payment (amort + interest) comes from cash
      boxOutflows += detail.payment;
      boxPayments[box.id] = detail.payment;

      // Balance tracks amortization progress (not total paid)
      boxBalances[box.id] = box.financing.principal - detail.outstandingBalance;

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
      month: i,
      date,
      income,
      costOfLiving,
      surplus,
      cash,
      boxes: { ...boxBalances },
      boxPayments,
      boxYields: { ...boxYields },
      totalYield: Object.values(boxYields).reduce((sum, v) => sum + v, 0),
      scheduledMovements: monthScheduledMovements,
      totalWealth,
      totalCommitted,
      financingDetails,
    });
  }

  return result;
}
