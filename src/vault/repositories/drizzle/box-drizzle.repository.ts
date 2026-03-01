import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { Box } from '../../domain/box';
import { BoxRepository } from '../box.repository';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import { box } from '@/shared/persistence/drizzle/schema';

@Injectable()
export class BoxDrizzleRepository extends BoxRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  async findByVaultId(vaultId: string): Promise<Box[]> {
    const rows = await this.db
      .select()
      .from(box)
      .where(eq(box.vaultId, vaultId));

    return rows.map((row) =>
      Box.restore({
        id: row.id,
        vaultId: row.vaultId,
        name: row.name,
        goalAmount: row.goalAmount,
        isDefault: row.isDefault,
        createdAt: row.createdAt,
      }),
    );
  }

  async findById(id: string): Promise<Box | null> {
    const rows = await this.db
      .select()
      .from(box)
      .where(eq(box.id, id));

    if (rows.length === 0) return null;
    const row = rows[0];

    return Box.restore({
      id: row.id,
      vaultId: row.vaultId,
      name: row.name,
      goalAmount: row.goalAmount,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
    });
  }

  async create(boxEntity: Box): Promise<void> {
    await this.db.insert(box).values({
      id: boxEntity.id,
      vaultId: boxEntity.vaultId,
      name: boxEntity.name,
      goalAmount: boxEntity.goalAmount,
      isDefault: boxEntity.isDefault,
      createdAt: boxEntity.createdAt,
    });
  }

  async update(boxEntity: Box): Promise<void> {
    await this.db
      .update(box)
      .set({
        name: boxEntity.name,
        goalAmount: boxEntity.goalAmount,
      })
      .where(eq(box.id, boxEntity.id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(box).where(eq(box.id, id));
  }

  async findDefaultByVaultId(vaultId: string): Promise<Box | null> {
    const rows = await this.db
      .select()
      .from(box)
      .where(
        and(eq(box.vaultId, vaultId), eq(box.isDefault, true)),
      );

    if (rows.length === 0) return null;
    const row = rows[0];

    return Box.restore({
      id: row.id,
      vaultId: row.vaultId,
      name: row.name,
      goalAmount: row.goalAmount,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
    });
  }
}
