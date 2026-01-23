import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Action, ActionPayload, ActionType, ActionStatus } from '../../domain/action';
import { ActionRepository } from '../action.repository';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import { action } from '@/shared/persistence/drizzle/schema';

@Injectable()
export class ActionDrizzleRepository extends ActionRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  async upsert(actionEntity: Action): Promise<void> {
    await this.db
      .insert(action)
      .values({
        id: actionEntity.id,
        type: actionEntity.type,
        payload: actionEntity.payload,
        createdAt: actionEntity.createdAt,
        status: actionEntity.status,
      })
      .onConflictDoUpdate({
        target: action.id,
        set: {
          type: actionEntity.type,
          payload: actionEntity.payload,
          createdAt: actionEntity.createdAt,
          status: actionEntity.status,
        },
      });
  }

  async findById(id: string): Promise<Action | null> {
    const rows = await this.db.select().from(action).where(eq(action.id, id));
    if (rows.length === 0) return null;
    const row = rows[0];
    return Action.restore({
      id: row.id,
      type: row.type as ActionType,
      payload: row.payload as ActionPayload,
      createdAt: row.createdAt.toISOString(),
      status: row.status as ActionStatus,
    });
  }
}
