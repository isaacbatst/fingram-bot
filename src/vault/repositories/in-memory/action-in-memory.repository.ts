/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { Action } from '../../domain/action';
import { ActionRepository } from '../action.repository';
import { InMemoryStore } from './in-memory-store';

@Injectable()
export class ActionInMemoryRepository extends ActionRepository {
  constructor(private store: InMemoryStore) {
    super();
  }

  async upsert(action: Action): Promise<void> {
    this.store.actions.set(action.id, action);
  }

  async findById(id: string): Promise<Action | null> {
    return this.store.actions.get(id) ?? null;
  }
}
