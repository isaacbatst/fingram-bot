import { Allocation } from '@/plan/shared/domain/allocation';
import { getActiveValue } from './change-point';
import {
  computeFinancingMonth,
  FinancingState,
  initFinancingState,
} from './financing-calculator';
import { FinancingMonthDetail, MonthData, Premises, RealMonthData } from './plan';

function getAllocationOutflow(
  allocation: Allocation,
  month: number,
  currentBalance: number,
): {
  outflow: number;
  scheduledMovements: { amount: number; label: string }[];
} {
  const paymentsThisMonth = (allocation.scheduledMovements ?? []).filter(
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
      outflow += getActiveValue(allocation.monthlyAmount, month);
    }

    return {
      outflow,
      scheduledMovements: paymentsThisMonth.map((p) => ({
        amount: p.amount,
        label: p.label,
      })),
    };
  }

  if (allocation.target > 0 && currentBalance >= allocation.target) {
    return { outflow: 0, scheduledMovements: [] };
  }

  let outflow = getActiveValue(allocation.monthlyAmount, month);

  if (allocation.target > 0) {
    const remaining = allocation.target - currentBalance;
    outflow = Math.min(outflow, remaining);
  }

  return { outflow, scheduledMovements: [] };
}

export function runProjection(
  premises: Premises,
  allocations: Allocation[],
  startDate: Date,
  months?: number,
  realData?: RealMonthData[],
  currentMonth?: number,
): MonthData[] {
  const totalMonths = months ?? 120;
  const realDataMap = new Map<number, RealMonthData>();
  if (realData) {
    for (const rd of realData) {
      realDataMap.set(rd.month, rd);
    }
  }

  const allocationBalances: Record<string, number> = {};
  const allocationAccumulated: Record<string, number> = {};
  const allocationRealized: Record<string, number> = {};
  const targetReached: Record<string, boolean> = {};
  const financingStates: Record<string, FinancingState> = {};

  for (const allocation of allocations) {
    const initial = allocation.initialBalance ?? 0;
    allocationBalances[allocation.id] = initial;
    allocationAccumulated[allocation.id] = initial;
    allocationRealized[allocation.id] = allocation.realizationMode === 'immediate' ? initial : 0;
    if (allocation.financing) {
      financingStates[allocation.id] = initFinancingState(allocation.financing);
    }
  }

  let cash = 0;
  const result: MonthData[] = [];

  for (let i = 0; i < totalMonths; i++) {
    const start = new Date(startDate);
    const date = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1),
    );

    const rd = realDataMap.get(i);
    const isReal = !!rd && currentMonth !== undefined && i < currentMonth;

    const income = isReal ? rd.realIncome : getActiveValue(premises.salaryChangePoints, i);
    const costOfLiving = isReal ? rd.realCostOfLiving : getActiveValue(
      premises.costOfLivingChangePoints,
      i,
    );

    // Build a lookup for real allocation payments
    const realAllocationPaymentsMap = new Map<string, number>();
    if (isReal && rd.allocationPayments) {
      for (const ap of rd.allocationPayments) {
        realAllocationPaymentsMap.set(ap.allocationId, ap.amount);
      }
    }

    let allocationOutflows = 0;
    const allocationPayments: Record<string, number> = {};
    const allocationYields: Record<string, number> = {};
    const financingDetails: Record<string, FinancingMonthDetail> = {};
    const monthScheduledMovements: {
      allocationId: string;
      amount: number;
      label: string;
      type: 'in' | 'out';
      destinationBoxId?: string;
    }[] = [];
    const extraAmortizations: Record<string, number> = {};

    // Pass 1: Process regular allocations (deposits + yields) so balances are
    // up-to-date before financing allocations reference them.
    for (const allocation of allocations) {
      if (allocation.financing) continue;

      // If real data is available for this allocation, use it instead of computed outflow
      if (isReal && realAllocationPaymentsMap.has(allocation.id)) {
        const realPayment = realAllocationPaymentsMap.get(allocation.id)!;
        allocationBalances[allocation.id] += realPayment;
        allocationOutflows += realPayment;
        allocationPayments[allocation.id] = realPayment;
        allocationAccumulated[allocation.id] += realPayment;
        if (allocation.realizationMode === 'immediate') {
          allocationRealized[allocation.id] += realPayment;
        }
      } else {
        const { outflow, scheduledMovements: inMovements } = getAllocationOutflow(
          allocation,
          i,
          allocationBalances[allocation.id],
        );

        allocationBalances[allocation.id] += outflow;
        allocationOutflows += outflow;
        allocationPayments[allocation.id] = outflow;
        allocationAccumulated[allocation.id] += outflow;
        if (allocation.realizationMode === 'immediate') {
          allocationRealized[allocation.id] += outflow;
        }

        for (const sp of inMovements) {
          monthScheduledMovements.push({
            allocationId: allocation.id,
            amount: sp.amount,
            label: sp.label,
            type: 'in',
          });
        }
      }

      let yieldEarned = 0;
      if (
        allocation.holdsFunds &&
        allocation.yieldRate &&
        allocation.yieldRate > 0 &&
        allocationBalances[allocation.id] > 0
      ) {
        const monthlyRate = allocation.yieldRate / 12;
        yieldEarned = allocationBalances[allocation.id] * monthlyRate;
        allocationBalances[allocation.id] += yieldEarned;
        allocationAccumulated[allocation.id] += yieldEarned;
      }
      allocationYields[allocation.id] = yieldEarned;

      // Process 'out' movements for this allocation
      const outsThisMonth = (allocation.scheduledMovements ?? []).filter(
        (p) => p.month === i && p.type === 'out',
      );

      for (const out of outsThisMonth) {
        const available = allocationBalances[allocation.id] ?? 0;
        const deduction = Math.min(out.amount, available);
        allocationBalances[allocation.id] -= deduction;

        if (out.destinationBoxId) {
          const destAllocation = allocations.find(
            (a) => a.id === out.destinationBoxId,
          );
          if (destAllocation?.financing) {
            extraAmortizations[out.destinationBoxId] =
              (extraAmortizations[out.destinationBoxId] ?? 0) + deduction;
          } else {
            allocationBalances[out.destinationBoxId] =
              (allocationBalances[out.destinationBoxId] ?? 0) + deduction;
          }
        } else {
          allocationOutflows -= deduction;
        }

        monthScheduledMovements.push({
          allocationId: allocation.id,
          amount: deduction,
          label: out.label,
          type: 'out',
          destinationBoxId: out.destinationBoxId,
        });
      }
    }

    // Pass 2: Process financing allocations (may deduct from source allocations).
    for (const allocation of allocations) {
      if (!allocation.financing) continue;

      const financingStart = allocation.financing.startMonth ?? 0;

      // Before financing starts, no payments
      if (i < financingStart) {
        allocationPayments[allocation.id] = 0;
        allocationYields[allocation.id] = 0;
        continue;
      }

      const financingMonth = i - financingStart;

      // Process 'in' movements on financing allocation as extra amortization from cash
      const financingInsThisMonth = (
        allocation.scheduledMovements ?? []
      ).filter((p) => p.month === i && p.type === 'in');

      let extraAmortization = extraAmortizations[allocation.id] ?? 0;
      for (const sp of financingInsThisMonth) {
        extraAmortization += sp.amount;
        allocationOutflows += sp.amount;
        monthScheduledMovements.push({
          allocationId: allocation.id,
          amount: sp.amount,
          label: sp.label,
          type: 'in',
        });
      }

      const { detail, nextState } = computeFinancingMonth(
        allocation.financing,
        financingStates[allocation.id],
        financingMonth,
        extraAmortization,
      );

      financingStates[allocation.id] = nextState;
      financingDetails[allocation.id] = detail;

      // Full payment (amort + interest) comes from cash
      allocationOutflows += detail.payment;
      allocationPayments[allocation.id] = detail.payment;

      // Balance tracks amortization progress (not total paid)
      const amortProgress = allocation.financing.principal - detail.outstandingBalance;
      allocationBalances[allocation.id] = amortProgress;
      allocationAccumulated[allocation.id] = amortProgress;
      if (allocation.realizationMode === 'immediate') {
        allocationRealized[allocation.id] = amortProgress;
      }

      // No yield on financing allocations
      allocationYields[allocation.id] = 0;
    }

    const surplus = income - costOfLiving - allocationOutflows;
    cash += surplus;

    let totalWealth = cash;
    let totalCommitted = 0;
    for (const allocation of allocations) {
      const emMaos = allocationAccumulated[allocation.id] - allocationRealized[allocation.id];
      totalWealth += emMaos;
      totalCommitted += allocationRealized[allocation.id];
    }

    result.push({
      month: i,
      date,
      income,
      costOfLiving,
      surplus,
      cash,
      allocations: { ...allocationBalances },
      allocationPayments,
      allocationYields: { ...allocationYields },
      totalYield: Object.values(allocationYields).reduce(
        (sum, v) => sum + v,
        0,
      ),
      scheduledMovements: monthScheduledMovements,
      totalWealth,
      totalCommitted,
      financingDetails,
      isReal,
      allocationAccumulated: { ...allocationAccumulated },
      allocationRealized: { ...allocationRealized },
      realizedAllocations: [],
    });
  }

  return result;
}
