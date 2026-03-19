import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import * as schema from '@/shared/persistence/drizzle/schema';
import { ChangePoint } from '@/plan/domain/change-point';
import {
  Allocation,
  AllocationFinancing,
  AllocationScheduledMovement,
  RealizationMode,
} from '../../domain/allocation';
import { AllocationRepository } from '../allocation.repository';

type AllocationRow = typeof schema.allocation.$inferSelect;

@Injectable()
export class AllocationDrizzleRepository extends AllocationRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  private getDb(tx?: unknown): DrizzleDatabase {
    return (tx ?? this.db) as DrizzleDatabase;
  }

  private toRow(allocation: Allocation): typeof schema.allocation.$inferInsert {
    return {
      id: allocation.id,
      planId: allocation.planId,
      label: allocation.label,
      target: allocation.target,
      monthlyAmount: allocation.monthlyAmount,
      realizationMode: allocation.realizationMode,
      yieldRate: allocation.yieldRate ?? null,
      financing: allocation.financing ?? null,
      scheduledMovements: allocation.scheduledMovements,
      initialBalance: allocation.initialBalance ?? null,
      estratoId: allocation.estratoId,
      createdAt: allocation.createdAt,
    };
  }

  private toDomain(row: AllocationRow): Allocation {
    return Allocation.restore({
      id: row.id,
      planId: row.planId,
      label: row.label,
      target: row.target,
      monthlyAmount: (row.monthlyAmount as ChangePoint[]) ?? [],
      realizationMode: row.realizationMode as RealizationMode,
      yieldRate: row.yieldRate ?? undefined,
      financing: (row.financing as AllocationFinancing) ?? undefined,
      scheduledMovements:
        (row.scheduledMovements as AllocationScheduledMovement[]) ?? [],
      initialBalance: row.initialBalance ?? undefined,
      estratoId: row.estratoId ?? null,
      createdAt: row.createdAt,
    });
  }

  async create(allocation: Allocation, tx?: unknown): Promise<void> {
    const db = this.getDb(tx);
    await db.insert(schema.allocation).values(this.toRow(allocation));
  }

  async createMany(allocations: Allocation[], tx?: unknown): Promise<void> {
    if (allocations.length === 0) return;
    const db = this.getDb(tx);
    await db
      .insert(schema.allocation)
      .values(allocations.map((a) => this.toRow(a)));
  }

  async update(allocation: Allocation, tx?: unknown): Promise<void> {
    const db = this.getDb(tx);
    await db
      .update(schema.allocation)
      .set({
        label: allocation.label,
        target: allocation.target,
        monthlyAmount: allocation.monthlyAmount,
        yieldRate: allocation.yieldRate ?? null,
        financing: allocation.financing ?? null,
        scheduledMovements: allocation.scheduledMovements,
        initialBalance: allocation.initialBalance ?? null,
        estratoId: allocation.estratoId,
      })
      .where(eq(schema.allocation.id, allocation.id));
  }

  async delete(id: string, tx?: unknown): Promise<void> {
    const db = this.getDb(tx);
    await db.delete(schema.allocation).where(eq(schema.allocation.id, id));
  }

  async findById(id: string): Promise<Allocation | null> {
    const rows = await this.db
      .select()
      .from(schema.allocation)
      .where(eq(schema.allocation.id, id));
    if (rows.length === 0) return null;
    return this.toDomain(rows[0]);
  }

  async findByPlanId(planId: string): Promise<Allocation[]> {
    const rows = await this.db
      .select()
      .from(schema.allocation)
      .where(eq(schema.allocation.planId, planId));
    return rows.map((row) => this.toDomain(row));
  }

  async findByVaultId(vaultId: string): Promise<Allocation[]> {
    const rows = await this.db
      .select({ allocation: schema.allocation })
      .from(schema.allocation)
      .innerJoin(schema.plan, eq(schema.allocation.planId, schema.plan.id))
      .where(eq(schema.plan.vaultId, vaultId));
    return rows.map((row) => this.toDomain(row.allocation));
  }

  async findByEstratoId(estratoId: string): Promise<Allocation | null> {
    const rows = await this.db
      .select()
      .from(schema.allocation)
      .where(eq(schema.allocation.estratoId, estratoId));
    if (rows.length === 0) return null;
    return this.toDomain(rows[0]);
  }
}
