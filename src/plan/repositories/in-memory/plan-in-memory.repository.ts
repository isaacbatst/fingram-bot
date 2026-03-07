/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { Plan } from '../../domain/plan';
import { PlanRepository } from '../plan.repository';

@Injectable()
export class PlanInMemoryRepository extends PlanRepository {
  private readonly plans = new Map<string, Plan>();

  async create(plan: Plan): Promise<void> {
    this.plans.set(plan.id, plan);
  }

  async findById(id: string): Promise<Plan | null> {
    return this.plans.get(id) ?? null;
  }

  async findByVaultId(vaultId: string): Promise<Plan[]> {
    const result: Plan[] = [];
    for (const plan of this.plans.values()) {
      if (plan.vaultId === vaultId) {
        result.push(plan);
      }
    }
    return result;
  }

  async update(plan: Plan): Promise<void> {
    if (this.plans.has(plan.id)) {
      this.plans.set(plan.id, plan);
    }
  }

  async delete(id: string): Promise<void> {
    this.plans.delete(id);
  }
}
