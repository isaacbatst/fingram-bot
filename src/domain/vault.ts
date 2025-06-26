import { Either, left, right } from './either';
import { Transaction } from './transaction';
import * as crypto from 'crypto';

export class Vault {
  static generateId(): string {
    return crypto.randomUUID();
  }

  static generateToken(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  constructor(
    public readonly id = Vault.generateId(),
    public readonly token = Vault.generateToken(),
    public readonly users: { id: string; name: string }[] = [],
    public readonly createdAt: Date = new Date(),
    public readonly entries: { transaction: Transaction }[] = [],
    public readonly transactions: Map<string, Transaction> = new Map(),
  ) {}

  static create(params: { users: { id: string; name: string }[] }): Vault {
    return new Vault(
      Vault.generateId(),
      Vault.generateToken(),
      params.users,
      new Date(),
    );
  }

  addTransaction(transaction: Transaction): void {
    this.transactions.set(transaction.id, transaction);
  }

  commitTransaction(id: string): Either<string, boolean> {
    const transaction = this.transactions.get(id);
    if (!transaction) return left(`Transaction with id ${id} not found`);
    const [err] = transaction.commit();
    if (err !== null) {
      return left(err);
    }
    this.entries.push({
      transaction: transaction,
    });
    return right(true);
  }

  editTransaction(id: string, newAmount: number): Either<string, boolean> {
    const transaction = this.transactions.get(id);
    if (!transaction) return left(`Transaction with id ${id} not found`);
    transaction.amount = newAmount;
    const entryIndex = this.entries.findIndex(
      (entry) => entry.transaction.id === id,
    );
    if (entryIndex !== -1) {
      this.entries[entryIndex].transaction = transaction;
    }
    return right(true);
  }

  getBalance(): number {
    return this.entries.reduce(
      (total, entry) => total + entry.transaction.amount,
      0,
    );
  }
}
