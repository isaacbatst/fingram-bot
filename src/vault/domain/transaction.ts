import crypto from 'crypto';
import { Either, left, right } from './either';
import { TransactionDTO } from '../dto/transaction.dto,';
import { Category } from './category';

export class Transaction {
  static create({
    amount,
    description,
    vaultId,
    type = 'expense',
    categoryId = null,
    date = new Date(),
  }: {
    amount: number;
    vaultId: string;
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
      vaultId,
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
    vaultId,
  }: {
    id: string;
    code: string;
    amount: number;
    vaultId: string;
    isCommitted?: boolean;
    description?: string;
    createdAt?: Date;
    categoryId?: string | null;
    type?: 'expense' | 'income';
  }): Transaction {
    return new Transaction(
      id,
      code,
      vaultId,
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
    public readonly vaultId: string,
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
    };
  }
}
