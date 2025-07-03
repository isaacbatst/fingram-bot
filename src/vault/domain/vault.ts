import * as crypto from 'crypto';
import { Category } from './category';
import { Either, left, right } from './either';
import { Transaction } from './transaction';
import { ChangesTracker } from './changes-tracker';

export type BudgetSummary = {
  category: Category;
  spent: number;
  amount: number;
  percentageUsed: number;
};
export class Vault {
  static generateId(): string {
    return crypto.randomUUID();
  }

  static generateToken(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  readonly transactionsTracker = new ChangesTracker<Transaction>();
  readonly budgetsTracker = new ChangesTracker<{
    category: Category;
    amount: number;
  }>();

  constructor(
    public readonly id = Vault.generateId(),
    public readonly token = Vault.generateToken(),
    public readonly createdAt: Date = new Date(),
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
    this.transactionsTracker.registerNew(transaction);
  }

  commitTransaction(id: string): Either<string, boolean> {
    const transaction = this.transactions.get(id);
    if (!transaction) return left(`Transação #${id} não encontrada`);
    const [err] = transaction.commit();
    if (err !== null) {
      return left(err);
    }
    this.transactionsTracker.registerDirty(transaction);
    return right(true);
  }

  editTransaction(
    code: string,
    options: {
      newAmount?: number;
      description?: string;
      categoryId?: string;
      date?: Date;
    },
  ): Either<string, Transaction> {
    const transaction = this.findTransactionByCode(code);
    if (!transaction) return left(`Transação #${code} não encontrada`);

    if (options.newAmount !== undefined) {
      transaction.amount = options.newAmount;
    }
    if (options.description !== undefined) {
      transaction.description = options.description;
    }
    if (options.categoryId !== undefined) {
      transaction.categoryId = options.categoryId;
    }
    if (options.date !== undefined) {
      transaction.createdAt = options.date;
    }

    this.transactions.set(transaction.id, transaction);
    this.transactionsTracker.registerDirty(transaction);
    return right(transaction);
  }

  deleteTransaction(code: string): Either<string, boolean> {
    const transaction = this.findTransactionByCode(code);
    if (!transaction) return left(`Transação #${code} não encontrada`);
    this.transactions.delete(transaction.id);
    this.transactionsTracker.registerDeleted(transaction);
    return right(true);
  }

  getBalance(): number {
    const sumOrSubtract = (
      type: 'income' | 'expense',
      amount: number,
    ): number => {
      return type === 'income' ? amount : -amount;
    };
    let total = 0;
    for (const transaction of this.transactions.values()) {
      if (!transaction.isCommitted) continue;
      total += sumOrSubtract(transaction.type, transaction.amount);
    }
    return total;
  }

  findTransactionByCode(code: string): Transaction | null {
    for (const transaction of this.transactions.values()) {
      if (transaction.code === code) {
        return transaction;
      }
    }
    return null;
  }

  setBudget(category: Category, amount: number): Either<string, boolean> {
    if (amount < 0) {
      return left('O valor do orçamento não pode ser negativo');
    }
    this.budgets.set(category.id, { category, amount });
    this.budgetsTracker.registerNew({
      category,
      amount,
    });
    return right(true);
  }

  getBudgetsSummary(month?: number, year?: number): BudgetSummary[] {
    const summary: BudgetSummary[] = [];

    for (const [categoryId, budget] of this.budgets.entries()) {
      const spent = Array.from(this.transactions.values())
        .filter(
          (transaction) =>
            transaction.categoryId === categoryId &&
            transaction.type === 'expense' &&
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
    for (const transaction of this.transactions.values()) {
      if (transaction.type === 'expense') {
        total += Math.abs(transaction.amount);
      }
    }
    return total;
  }
}
