import { Allocation } from '@/plan/shared/domain/allocation';
import { getActiveValue } from './change-point';
import {
  computeFinancingMonth,
  FinancingState,
  initFinancingState,
} from './financing-calculator';
import {
  FinancingMonthDetail,
  MonthData,
  Premises,
  RealMonthData,
} from './plan';

function getMonthlyAporte(
  allocation: Allocation,
  month: number,
  currentAccumulated: number,
): number {
  if (allocation.target > 0 && currentAccumulated >= allocation.target) {
    return 0;
  }

  let outflow = getActiveValue(allocation.monthlyAmount, month);

  if (allocation.target > 0) {
    const remaining = allocation.target - currentAccumulated;
    outflow = Math.min(outflow, remaining);
  }

  return outflow;
}

function getScheduledInMovements(
  allocation: Allocation,
  month: number,
): {
  total: number;
  hasAdditional: boolean;
  movements: { amount: number; label: string }[];
} {
  const paymentsThisMonth = (allocation.scheduledMovements ?? []).filter(
    (p) => p.month === month && p.type === 'in',
  );

  if (paymentsThisMonth.length === 0) {
    return { total: 0, hasAdditional: false, movements: [] };
  }

  const total = paymentsThisMonth.reduce((sum, p) => sum + p.amount, 0);
  const hasAdditional = paymentsThisMonth.some((p) => p.additionalToMonthly);
  const movements = paymentsThisMonth.map((p) => ({
    amount: p.amount,
    label: p.label,
  }));

  return { total, hasAdditional, movements };
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
    allocationRealized[allocation.id] =
      allocation.realizationMode === 'immediate' ? initial : 0;
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

    const income = isReal
      ? rd.realIncome
      : getActiveValue(premises.salaryChangePoints, i);
    const costOfLiving = isReal
      ? rd.realCostOfLiving
      : getActiveValue(premises.costOfLivingChangePoints, i);

    // Build a lookup for real allocation payments (only for fully past months)
    const realAllocationPaymentsMap = new Map<string, number>();
    if (isReal && rd.allocationPayments) {
      for (const ap of rd.allocationPayments) {
        realAllocationPaymentsMap.set(ap.allocationId, ap.amount);
      }
    }

    // Track real realizations and payments as discrete events (past + current month)
    // Unlike income/costOfLiving which need a full month, these are facts that should reflect immediately
    if (rd?.allocationRealizations) {
      for (const ar of rd.allocationRealizations) {
        allocationRealized[ar.allocationId] =
          (allocationRealized[ar.allocationId] ?? 0) + ar.amount;
      }
    }
    if (!isReal && rd?.allocationPayments) {
      // Current month: overlay real payments on top of projected for immediate allocations
      for (const ap of rd.allocationPayments) {
        const allocation = allocations.find((a) => a.id === ap.allocationId);
        if (allocation?.realizationMode === 'immediate') {
          allocationRealized[ap.allocationId] =
            (allocationRealized[ap.allocationId] ?? 0) + ap.amount;
        }
      }
    }

    let allocationOutflows = 0;
    const allocationPayments: Record<string, number> = {};
    const allocationYields: Record<string, number> = {};
    const financingDetails: Record<string, FinancingMonthDetail> = {};
    const monthRealizedAllocations: string[] = [];
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

      const id = allocation.id;
      let totalPayment = 0;

      if (isReal && realAllocationPaymentsMap.has(id)) {
        // Real data path: use actual recorded payment
        const realPayment = realAllocationPaymentsMap.get(id)!;
        allocationBalances[id] += realPayment;
        allocationOutflows += realPayment;
        allocationAccumulated[id] += realPayment;
        if (allocation.realizationMode === 'immediate') {
          allocationRealized[id] += realPayment;
        }
        totalPayment = realPayment;
      } else {
        // Phase A: Regular monthly aporte (skip if targetReached)
        let monthlyAporte = 0;
        if (!targetReached[id]) {
          monthlyAporte = getMonthlyAporte(
            allocation,
            i,
            allocationAccumulated[id],
          );
        }

        // Phase B-in: Scheduled 'in' movements (ALWAYS processed, even after targetReached)
        const {
          total: scheduledTotal,
          hasAdditional,
          movements: inMovements,
        } = getScheduledInMovements(allocation, i);

        let outflow: number;
        if (scheduledTotal > 0) {
          // Scheduled 'in' replaces monthly, unless additionalToMonthly
          const additionalMonthly =
            hasAdditional && !targetReached[id]
              ? getActiveValue(allocation.monthlyAmount, i)
              : 0;
          outflow = scheduledTotal + additionalMonthly;
        } else {
          outflow = monthlyAporte;
        }

        allocationBalances[id] += outflow;
        allocationOutflows += outflow;
        allocationAccumulated[id] += outflow;
        if (allocation.realizationMode === 'immediate') {
          allocationRealized[id] += outflow;
        }
        totalPayment = outflow;

        for (const sp of inMovements) {
          monthScheduledMovements.push({
            allocationId: id,
            amount: sp.amount,
            label: sp.label,
            type: 'in',
          });
        }

        // Phase D: Target check — set targetReached permanently after aportes
        if (
          allocation.target > 0 &&
          allocationAccumulated[id] >= allocation.target
        ) {
          if (!targetReached[id]) {
            targetReached[id] = true;
            // onCompletion: auto-realize all accumulated when target first reached
            if (allocation.realizationMode === 'onCompletion') {
              allocationRealized[id] = allocationAccumulated[id];
              // Sync balance to em_mãos (= 0 after full realization)
              allocationBalances[id] =
                allocationAccumulated[id] - allocationRealized[id];
              monthRealizedAllocations.push(id);
            }
          }
        }
      }

      allocationPayments[id] = totalPayment;

      // Phase C: Yield (skip if targetReached; only for non-immediate modes that hold funds)
      let yieldEarned = 0;
      if (
        !targetReached[id] &&
        allocation.realizationMode !== 'immediate' &&
        allocation.yieldRate &&
        allocation.yieldRate > 0 &&
        allocationBalances[id] > 0
      ) {
        const monthlyRate = allocation.yieldRate / 12;
        yieldEarned = allocationBalances[id] * monthlyRate;
        allocationBalances[id] += yieldEarned;
        allocationAccumulated[id] += yieldEarned;
      }
      allocationYields[id] = yieldEarned;

      // Phase B-out: 'out' scheduled movements (ALWAYS processed, even after targetReached)
      const outsThisMonth = (allocation.scheduledMovements ?? []).filter(
        (p) => p.month === i && p.type === 'out',
      );

      for (const out of outsThisMonth) {
        const available = allocationBalances[id] ?? 0;
        const deduction = Math.min(out.amount, available);
        allocationBalances[id] -= deduction;

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
          allocationId: id,
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
      const amortProgress =
        allocation.financing.principal - detail.outstandingBalance;
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
      const emMaos =
        allocationAccumulated[allocation.id] -
        allocationRealized[allocation.id];
      // Only permanent reserves (never) count as patrimônio
      if (allocation.realizationMode === 'never') {
        totalWealth += emMaos;
      }
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
      realizedAllocations: monthRealizedAllocations,
    });
  }

  return result;
}
