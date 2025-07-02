import crypto from 'crypto';
import { Either, left, right } from './either';

export class Transaction {
  static create({
    amount,
    description,
    type = 'expense',
    categoryId = null,
    date = new Date(),
  }: {
    amount: number;
    description?: string;
    type?: 'expense' | 'income';
    date?: Date;
    categoryId?: string | null;
  }): Transaction {
    const id = crypto.randomUUID();
    const code = crypto.randomBytes(2).toString('hex');
    return new Transaction(
      id,
      code,
      amount,
      false,
      description,
      date,
      categoryId,
      type,
    );
  }

  static restore({
    id,
    code,
    amount,
    isCommitted = false,
    description,
    createdAt = new Date(),
    categoryId = null,
    type = 'expense',
  }: {
    id: string;
    code: string;
    amount: number;
    isCommitted?: boolean;
    description?: string;
    createdAt?: Date;
    categoryId?: string | null;
    type?: 'expense' | 'income';
  }): Transaction {
    return new Transaction(
      id,
      code,
      amount,
      isCommitted,
      description,
      createdAt,
      categoryId,
      type,
    );
  }

  private constructor(
    readonly id: string,
    readonly code: string,
    public amount: number,
    public isCommitted: boolean = false,
    public description?: string,
    public createdAt: Date = new Date(),
    public categoryId: string | null = null,
    public type: 'expense' | 'income' = 'expense',
  ) {}

  commit(): Either<string, boolean> {
    if (this.isCommitted) {
      return left(`Transação #${this.code} já efetivada`);
    }
    this.isCommitted = true;
    return right(true);
  }
}
