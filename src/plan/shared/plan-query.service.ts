import { Injectable } from '@nestjs/common';
import { PlanRepository } from '@/plan/repositories/plan.repository';
import { AllocationRepository } from './repositories/allocation.repository';
import { Plan } from '@/plan/domain/plan';
import { Allocation } from './domain/allocation';
import { getActiveValue } from '@/plan/domain/change-point';

export interface ScheduledMovementMatch {
  allocationId: string;
  allocationLabel: string;
  scheduledMovement: {
    month: number;
    amount: number;
    label: string;
  };
  divergencePercent: number; // 0 = exact match
  divergenceAmount: number; // absolute difference
}

@Injectable()
export class PlanQueryService {
  constructor(
    private readonly planRepo: PlanRepository,
    private readonly allocationRepo: AllocationRepository,
  ) {}

  async findPlanById(id: string): Promise<Plan | null> {
    return this.planRepo.findById(id);
  }

  async listPlansByVaultId(vaultId: string): Promise<Plan[]> {
    return this.planRepo.findByVaultId(vaultId);
  }

  async findAllocationById(id: string): Promise<Allocation | null> {
    return this.allocationRepo.findById(id);
  }

  async listAllocationsByPlanId(planId: string): Promise<Allocation[]> {
    return this.allocationRepo.findByPlanId(planId);
  }

  async listPaymentAllocations(vaultId: string): Promise<Allocation[]> {
    const all = await this.allocationRepo.findByVaultId(vaultId);
    return all.filter((a) => !a.holdsFunds);
  }

  async getAllocationsByVaultId(vaultId: string): Promise<Allocation[]> {
    return this.allocationRepo.findByVaultId(vaultId);
  }

  async getActiveCostOfLivingCeiling(
    vaultId: string,
    currentDate: Date,
  ): Promise<number | null> {
    const plans = await this.planRepo.findByVaultId(vaultId);
    const activePlan = plans.find((p) => p.status === 'active') ?? plans[0];
    if (!activePlan) return null;

    const startDate = activePlan.startDate;
    const monthsDiff =
      (currentDate.getFullYear() - startDate.getFullYear()) * 12 +
      (currentDate.getMonth() - startDate.getMonth());
    const planMonth = Math.max(0, monthsDiff);

    return getActiveValue(
      activePlan.premises.costOfLivingChangePoints,
      planMonth,
    );
  }

  async findMatchingScheduledMovement(
    vaultId: string,
    amount: number,
    currentDate: Date,
  ): Promise<ScheduledMovementMatch | null> {
    // 1. Get all allocations for this vault
    const allocations = await this.allocationRepo.findByVaultId(vaultId);

    // 2. Find the active plan to determine current plan month
    const plans = await this.planRepo.findByVaultId(vaultId);
    const plan = plans.find((p) => p.status === 'active') ?? plans[0];
    if (!plan) return null;

    const startDate = plan.startDate;
    const monthsDiff =
      (currentDate.getFullYear() - startDate.getFullYear()) * 12 +
      (currentDate.getMonth() - startDate.getMonth());
    const currentPlanMonth = Math.max(0, monthsDiff);

    // 3. For each Pagamento allocation, check scheduled movements for current month
    for (const allocation of allocations) {
      if (allocation.holdsFunds) continue; // Only Pagamento

      for (const sm of allocation.scheduledMovements) {
        if (sm.month !== currentPlanMonth) continue;
        if (sm.type !== 'in') continue; // Only incoming scheduled movements

        const divergenceAmount = Math.abs(amount - sm.amount);
        const divergencePercent =
          sm.amount > 0 ? (divergenceAmount / sm.amount) * 100 : 0;

        // Check if within tolerance: <=10% OR <=R$500 (whichever is smaller threshold)
        const percentThreshold = sm.amount * 0.1; // 10% of expected
        const absoluteThreshold = 500;
        const threshold = Math.min(percentThreshold, absoluteThreshold);

        if (divergenceAmount <= threshold || divergenceAmount === 0) {
          return {
            allocationId: allocation.id,
            allocationLabel: allocation.label,
            scheduledMovement: {
              month: sm.month,
              amount: sm.amount,
              label: sm.label,
            },
            divergencePercent:
              Math.round(divergencePercent * 100) / 100,
            divergenceAmount,
          };
        }
      }

      // Also check if amount matches the monthlyAmount for current month
      const activeMonthly = getActiveValue(
        allocation.monthlyAmount,
        currentPlanMonth,
      );
      if (activeMonthly > 0) {
        const divergenceAmount = Math.abs(amount - activeMonthly);
        const divergencePercent = (divergenceAmount / activeMonthly) * 100;
        const percentThreshold = activeMonthly * 0.1;
        const absoluteThreshold = 500;
        const threshold = Math.min(percentThreshold, absoluteThreshold);

        if (divergenceAmount <= threshold) {
          return {
            allocationId: allocation.id,
            allocationLabel: allocation.label,
            scheduledMovement: {
              month: currentPlanMonth,
              amount: activeMonthly,
              label: `Parcela mensal`,
            },
            divergencePercent:
              Math.round(divergencePercent * 100) / 100,
            divergenceAmount,
          };
        }
      }
    }

    return null;
  }
}
