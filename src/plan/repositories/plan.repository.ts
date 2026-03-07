import { Plan } from '../domain/plan';

export abstract class PlanRepository {
  abstract create(plan: Plan): Promise<void>;
  abstract findById(id: string): Promise<Plan | null>;
  abstract findByVaultId(vaultId: string): Promise<Plan[]>;
  abstract update(plan: Plan): Promise<void>;
  abstract delete(id: string): Promise<void>;
}
