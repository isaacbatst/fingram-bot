import { Injectable } from '@nestjs/common';
import { PlanRepository } from '@/plan/repositories/plan.repository';
import { AllocationRepository } from './repositories/allocation.repository';
import { Plan } from '@/plan/domain/plan';
import { Allocation } from './domain/allocation';

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
}
