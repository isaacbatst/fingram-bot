import { AllocationFinancing } from '@/plan/shared/domain/allocation';
import { FinancingMonthDetail, FinancingPhase } from './plan';

export interface FinancingState {
  outstandingBalance: number;
  remainingTermMonths: number;
}

export function initFinancingState(financing: AllocationFinancing): FinancingState {
  const constructionMonths = financing.constructionMonths ?? 0;
  const graceMonths = financing.gracePeriodMonths ?? 0;
  return {
    outstandingBalance: financing.principal,
    remainingTermMonths:
      financing.termMonths - constructionMonths - graceMonths,
  };
}

export function getSacInstallment(
  outstandingBalance: number,
  monthlyRate: number,
  remainingTermMonths: number,
): { amortization: number; interest: number; total: number } {
  const amortization = outstandingBalance / remainingTermMonths;
  const interest = outstandingBalance * monthlyRate;
  return { amortization, interest, total: amortization + interest };
}

export function getPriceInstallment(
  outstandingBalance: number,
  monthlyRate: number,
  remainingTermMonths: number,
): { amortization: number; interest: number; total: number } {
  const factor = Math.pow(1 + monthlyRate, remainingTermMonths);
  const total = (outstandingBalance * (monthlyRate * factor)) / (factor - 1);
  const interest = outstandingBalance * monthlyRate;
  const amortization = total - interest;
  return { amortization, interest, total };
}

export function getConstructionInterest(
  principal: number,
  monthlyRate: number,
  constructionMonth: number,
  totalConstructionMonths: number,
  releasePercent: number = 0.95,
): number {
  const releasedPerMonth =
    (principal * releasePercent) / totalConstructionMonths;
  const accumulatedReleased = releasedPerMonth * (constructionMonth + 1);
  return accumulatedReleased * monthlyRate;
}

function getPhase(
  financing: AllocationFinancing,
  month: number,
  outstandingBalance: number,
): FinancingPhase {
  const constructionMonths = financing.constructionMonths ?? 0;
  const graceMonths = financing.gracePeriodMonths ?? 0;

  if (outstandingBalance <= 0) return 'paid_off';
  if (month < constructionMonths) return 'construction';
  if (month < constructionMonths + graceMonths) return 'grace';
  return 'amortization';
}

export function computeFinancingMonth(
  financing: AllocationFinancing,
  state: FinancingState,
  month: number,
  extraAmortization: number,
): { detail: FinancingMonthDetail; nextState: FinancingState } {
  const monthlyRate = financing.annualRate / 12;
  const constructionMonths = financing.constructionMonths ?? 0;

  let { outstandingBalance } = state;
  const { remainingTermMonths } = state;
  const phase = getPhase(financing, month, outstandingBalance);

  // Extra amortization is ignored during construction (banks don't accept it
  // while funds are still being released to the builder).
  if (extraAmortization > 0 && phase !== 'construction') {
    outstandingBalance = Math.max(0, outstandingBalance - extraAmortization);
  }

  if (phase === 'paid_off' || outstandingBalance <= 0) {
    return {
      detail: {
        payment: 0,
        amortization: 0,
        interest: 0,
        outstandingBalance: 0,
        phase: 'paid_off',
      },
      nextState: { outstandingBalance: 0, remainingTermMonths },
    };
  }

  if (phase === 'construction') {
    const interest = getConstructionInterest(
      financing.principal,
      monthlyRate,
      month,
      constructionMonths,
      financing.releasePercent,
    );
    return {
      detail: {
        payment: interest,
        amortization: 0,
        interest,
        outstandingBalance,
        phase: 'construction',
      },
      nextState: { outstandingBalance, remainingTermMonths },
    };
  }

  if (phase === 'grace') {
    const interest = outstandingBalance * monthlyRate;
    return {
      detail: {
        payment: interest,
        amortization: 0,
        interest,
        outstandingBalance,
        phase: 'grace',
      },
      nextState: { outstandingBalance, remainingTermMonths },
    };
  }

  // Amortization phase
  if (remainingTermMonths <= 0) {
    return {
      detail: {
        payment: 0,
        amortization: 0,
        interest: 0,
        outstandingBalance,
        phase: 'paid_off',
      },
      nextState: { outstandingBalance, remainingTermMonths: 0 },
    };
  }

  const installment =
    financing.system === 'sac'
      ? getSacInstallment(outstandingBalance, monthlyRate, remainingTermMonths)
      : getPriceInstallment(
          outstandingBalance,
          monthlyRate,
          remainingTermMonths,
        );

  const newOutstanding = Math.max(
    0,
    outstandingBalance - installment.amortization,
  );

  return {
    detail: {
      payment: installment.total,
      amortization: installment.amortization,
      interest: installment.interest,
      outstandingBalance: newOutstanding,
      phase: 'amortization',
    },
    nextState: {
      outstandingBalance: newOutstanding,
      remainingTermMonths: remainingTermMonths - 1,
    },
  };
}
