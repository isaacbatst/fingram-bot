import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import { plan } from '@/shared/persistence/drizzle/schema';
import { Plan, PlanStatus, Premises, FundRule } from '../../domain/plan';
import { PlanRepository } from '../plan.repository';

@Injectable()
export class PlanDrizzleRepository extends PlanRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  async create(planEntity: Plan): Promise<void> {
    await this.db.insert(plan).values({
      id: planEntity.id,
      vaultId: planEntity.vaultId,
      name: planEntity.name,
      status: planEntity.status,
      startDate: planEntity.startDate,
      premises: planEntity.premises,
      fundAllocation: planEntity.fundAllocation,
      createdAt: planEntity.createdAt,
    });
  }

  async findById(id: string): Promise<Plan | null> {
    const rows = await this.db.select().from(plan).where(eq(plan.id, id));
    if (rows.length === 0) return null;
    return this.toDomain(rows[0]);
  }

  async findByVaultId(vaultId: string): Promise<Plan[]> {
    const rows = await this.db
      .select()
      .from(plan)
      .where(eq(plan.vaultId, vaultId));
    return rows.map((row) => this.toDomain(row));
  }

  async update(planEntity: Plan): Promise<void> {
    await this.db
      .update(plan)
      .set({
        name: planEntity.name,
        status: planEntity.status,
        startDate: planEntity.startDate,
        premises: planEntity.premises,
        fundAllocation: planEntity.fundAllocation,
      })
      .where(eq(plan.id, planEntity.id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(plan).where(eq(plan.id, id));
  }

  private toDomain(row: {
    id: string;
    vaultId: string;
    name: string;
    status: string;
    startDate: Date;
    premises: unknown;
    fundAllocation: unknown;
    createdAt: Date;
  }): Plan {
    return Plan.restore({
      id: row.id,
      vaultId: row.vaultId,
      name: row.name,
      status: row.status as PlanStatus,
      startDate: row.startDate,
      premises: row.premises as Premises,
      fundAllocation: row.fundAllocation as FundRule[],
      createdAt: row.createdAt,
    });
  }
}
