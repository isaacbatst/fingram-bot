import crypto from 'crypto';
import { Either, left, right } from './either';
import { TransactionDTO } from '../dto/transaction.dto,';
import { Category } from './category';

type ConstructorParams = {
  id: string;
  code: string;
  vaultId: string;
  amount: number;
  isCommitted: boolean;
  description?: string;
  createdAt: Date;
  categoryId: string | null;
  type: 'expense' | 'income';
  date: Date;
};

type CreateParams = {
  amount: number;
  vaultId: string;
  description?: string;
  type?: 'expense' | 'income';
  date: Date;
  categoryId?: string | null;
  createdAt?: Date;
};

export class Transaction {
  static create(params: CreateParams): Transaction {
    const id = crypto.randomUUID();
    const code = crypto.randomBytes(2).toString('hex');
    return new Transaction({
      id,
      code,
      vaultId: params.vaultId,
      amount: params.amount,
      isCommitted: false,
      description: params.description,
      createdAt: params.createdAt ?? new Date(),
      categoryId: params.categoryId ?? null,
      type: params.type ?? 'expense',
      date: params.date,
    });
  }

  static restore(params: ConstructorParams): Transaction {
    return new Transaction({
      ...params,
    });
  }
  readonly id: string;
  readonly code: string;
  public readonly vaultId: string;
  public amount: number;
  public isCommitted: boolean = false;
  public description?: string;
  public createdAt: Date = new Date();
  public categoryId: string | null = null;
  public type: 'expense' | 'income' = 'expense';
  public date: Date = new Date();

  private constructor(params: ConstructorParams) {
    this.id = params.id;
    this.code = params.code;
    this.vaultId = params.vaultId;
    this.amount = params.amount;
    this.isCommitted = params.isCommitted;
    this.description = params.description;
    this.createdAt = params.createdAt;
    this.categoryId = params.categoryId;
    this.type = params.type;
    this.date = params.date;
  }
  commit(): Either<string, boolean> {
    if (this.isCommitted) {
      return left(`Transação #${this.code} já efetivada`);
    }
    this.isCommitted = true;
    return right(true);
  }

  toDTO(category: Category | null): TransactionDTO {
    return {
      id: this.id,
      code: this.code,
      amount: this.amount,
      isCommitted: this.isCommitted,
      description: this.description,
      type: this.type,
      createdAt: this.createdAt,
      vaultId: this.vaultId,
      category,
      date: this.date,
    };
  }
}
