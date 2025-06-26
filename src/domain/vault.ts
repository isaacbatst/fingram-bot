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
    public readonly createdAt: Date = new Date(),
    public readonly entries: { transaction: Transaction }[] = [],
    public readonly transactions: Map<string, Transaction> = new Map(),
  ) {}

  static create(): Vault {
    return new Vault(Vault.generateId(), Vault.generateToken(), new Date());
  }

  addTransaction(transaction: Transaction): void {
    this.transactions.set(transaction.id, transaction);
  }

  commitTransaction(id: string): Either<string, boolean> {
    const transaction = this.transactions.get(id);
    if (!transaction) return left(`Transação #${id} não encontrada`);
    const [err] = transaction.commit();
    if (err !== null) {
      return left(err);
    }
    this.entries.push({
      transaction: transaction,
    });
    return right(true);
  }

  editTransaction(
    code: string,
    newAmount: number,
  ): Either<string, Transaction> {
    const transaction = this.findTransactionByCode(code);
    if (!transaction) return left(`Transação #${code} não encontrada`);
    transaction.amount = newAmount;
    const entryIndex = this.entries.findIndex(
      (entry) => entry.transaction.id === code,
    );
    if (entryIndex !== -1) {
      this.entries[entryIndex].transaction = transaction;
    }
    return right(transaction);
  }

  getBalance(): number {
    return this.entries.reduce(
      (total, entry) => total + entry.transaction.amount,
      0,
    );
  }

  findTransactionByCode(code: string): Transaction | null {
    for (const entry of this.entries) {
      if (entry.transaction.code === code) {
        return entry.transaction;
      }
    }
    return null;
  }
}
