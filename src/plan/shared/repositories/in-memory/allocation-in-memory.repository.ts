/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { Allocation } from '../../domain/allocation';
import { AllocationRepository } from '../allocation.repository';

@Injectable()
export class AllocationInMemoryRepository extends AllocationRepository {
  private readonly allocations = new Map<string, Allocation>();

  async create(allocation: Allocation, _tx?: unknown): Promise<void> {
    this.allocations.set(allocation.id, allocation);
  }

  async createMany(allocations: Allocation[], _tx?: unknown): Promise<void> {
    for (const allocation of allocations) {
      this.allocations.set(allocation.id, allocation);
    }
  }

  async update(allocation: Allocation, _tx?: unknown): Promise<void> {
    if (this.allocations.has(allocation.id)) {
      this.allocations.set(allocation.id, allocation);
    }
  }

  async delete(id: string, _tx?: unknown): Promise<void> {
    this.allocations.delete(id);
  }

  async findById(id: string): Promise<Allocation | null> {
    return this.allocations.get(id) ?? null;
  }

  async findByPlanId(planId: string): Promise<Allocation[]> {
    const result: Allocation[] = [];
    for (const allocation of this.allocations.values()) {
      if (allocation.planId === planId) {
        result.push(allocation);
      }
    }
    return result;
  }

  async findByVaultId(_vaultId: string): Promise<Allocation[]> {
    // In-memory doesn't have plan.vaultId context — returns all allocations
    // Acceptable for unit tests
    return Array.from(this.allocations.values());
  }

  async findByEstratoId(estratoId: string): Promise<Allocation | null> {
    for (const allocation of this.allocations.values()) {
      if (allocation.estratoId === estratoId) {
        return allocation;
      }
    }
    return null;
  }
}
