/* eslint-disable @typescript-eslint/require-await */
import { Action } from '../domain/action';
import { ActionRepository } from './action.repository';

export class ActionInMemoryRepository extends ActionRepository {
  private actions: Map<string, Action> = new Map();

  async upsert(action: Action): Promise<void> {
    this.actions.set(action.id, action);
  }

  async findById(id: string): Promise<Action | null> {
    return this.actions.get(id) ?? null;
  }
}
