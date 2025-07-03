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

export type ActionPayload = {
  amount: number;
  description?: string;
  categoryId?: string;
  createdAt?: Date;
};

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

  static restore({
    id,
    type,
    payload,
    createdAt,
    status,
  }: {
    id: string;
    type: ActionType;
    payload: ActionPayload;
    createdAt: Date | string;
    status: ActionStatus;
  }): Action {
    return new Action(id, type, payload, new Date(createdAt), status);
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
