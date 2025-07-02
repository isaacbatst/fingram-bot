import crypto from 'crypto';

export enum ActionType {
  EXPENSE = 'expense',
  INCOME = 'income',
}

export enum ActionStatus {
  PENDING = 'pending',
  EXECUTED = 'executed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export class Action {
  static create(
    type: ActionType,
    payload: {
      amount: number;
      description?: string;
      categoryId?: string;
      createdAt?: Date;
    },
  ): Action {
    return new Action(
      crypto.randomUUID(),
      type,
      payload,
      new Date(),
      ActionStatus.PENDING,
    );
  }

  constructor(
    readonly id: string,
    readonly type: ActionType,
    readonly payload: {
      amount: number;
      description?: string;
      categoryId?: string;
      createdAt?: Date;
    },
    readonly createdAt: Date = new Date(),
    public status: ActionStatus = ActionStatus.PENDING,
  ) {}
}
