import * as crypto from 'crypto';
import { Category } from './category';
import { Either, left, right } from './either';
import { Transaction } from './transaction';

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
    public readonly budgets: Map<
      string,
      { category: Category; amount: number }
    > = new Map(),
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
    const sumOrSubtract = (
      type: 'income' | 'expense',
      amount: number,
    ): number => {
      return type === 'income' ? amount : -amount;
    };

    return this.entries.reduce(
      (total, entry) =>
        total + sumOrSubtract(entry.transaction.type, entry.transaction.amount),
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

  setBudget(category: Category, amount: number): Either<string, boolean> {
    if (amount < 0) {
      return left('O valor do orçamento não pode ser negativo');
    }
    this.budgets.set(category.id, { category, amount });
    return right(true);
  }

  getBudgetsSummary(month?: number, year?: number) {
    const summary: {
      category: Category;
      spent: number;
      amount: number;
      percentageUsed: number;
    }[] = [];

    // Filtrando transações por mês e ano (se passados)
    for (const [categoryId, budget] of this.budgets.entries()) {
      const spent = Array.from(this.transactions.values())
        .filter(
          (transaction) =>
            transaction.categoryId === categoryId &&
            transaction.type === 'expense' &&
            // Filtro por data, se mês e ano forem passados
            (month
              ? new Date(transaction.createdAt).getMonth() + 1 === month
              : true) &&
            (year
              ? new Date(transaction.createdAt).getFullYear() === year
              : true),
        )
        .reduce(
          (total, transaction) => total + Math.abs(transaction.amount),
          0,
        );
      const percentageUsed =
        budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
      summary.push({
        category: budget.category,
        spent,
        amount: budget.amount,
        percentageUsed,
      });
    }
    return summary;
  }

  percentageTotalBudgetedAmount(): number {
    const totalBudgeted = this.totalBudgetedAmount();
    const totalSpent = this.totalSpentAmount();
    return totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0;
  }

  totalBudgetedAmount(): number {
    let total = 0;
    for (const budget of this.budgets.values()) {
      total += budget.amount;
    }
    return total;
  }
  totalSpentAmount(): number {
    let total = 0;
    for (const entry of this.entries) {
      if (entry.transaction.type === 'expense') {
        total += Math.abs(entry.transaction.amount);
      }
    }
    return total;
  }
}
