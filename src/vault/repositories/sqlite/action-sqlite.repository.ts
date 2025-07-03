import { Injectable, Inject } from '@nestjs/common';
import { Action, ActionPayload } from '../../domain/action';
import { ActionRepository } from '../action.repository';
import { SQLITE_DATABASE } from '@/shared/persistence/sqlite/sqlite.module';
import { Database } from 'better-sqlite3';
import { ActionRow } from '@/shared/persistence/sqlite/rows';
import { ActionType, ActionStatus } from '../../domain/action';

@Injectable()
export class ActionSqliteRepository extends ActionRepository {
  constructor(@Inject(SQLITE_DATABASE) private readonly db: Database) {
    super();
  }

  async upsert(action: Action): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO action (id, type, payload, created_at, status)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        action.id,
        action.type,
        JSON.stringify(action.payload),
        action.createdAt.toISOString(),
        action.status,
      );
    await Promise.resolve();
  }

  async findById(id: string): Promise<Action | null> {
    const row = this.db.prepare('SELECT * FROM action WHERE id = ?').get(id) as
      | ActionRow
      | undefined;
    await Promise.resolve();
    if (!row) return null;
    return Action.restore({
      id: row.id,
      type: row.type as ActionType,
      payload: JSON.parse(row.payload) as ActionPayload,
      createdAt: row.created_at,
      status: row.status as ActionStatus,
    });
  }
}
