import { Allocation } from '../domain/allocation';

export abstract class AllocationRepository {
  abstract create(allocation: Allocation, tx?: unknown): Promise<void>;
  abstract createMany(allocations: Allocation[], tx?: unknown): Promise<void>;
  abstract update(allocation: Allocation, tx?: unknown): Promise<void>;
  abstract delete(id: string, tx?: unknown): Promise<void>;
  abstract findById(id: string): Promise<Allocation | null>;
  abstract findByPlanId(planId: string): Promise<Allocation[]>;
  abstract findByVaultId(vaultId: string): Promise<Allocation[]>;
  abstract findByEstratoId(estratoId: string): Promise<Allocation | null>;
}
