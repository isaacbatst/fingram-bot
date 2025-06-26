import { Action } from '../domain/action';

export abstract class ActionRepository {
  abstract create(action: Action): Promise<void>;
  abstract findById(id: string): Promise<Action | null>;
}
