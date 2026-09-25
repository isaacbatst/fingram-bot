import * as crypto from 'crypto';
import { Box, BoxType } from './box';
import {
  BudgetStartDayOverride,
  BudgetStartDaySchedule,
  getBudgetPeriod as getBudgetPeriodFromSchedule,
  getCurrentBudgetPeriod as getCurrentBudgetPeriodFromSchedule,
  isDateInBudgetPeriod as isDateInBudgetPeriodFromSchedule,
  validateSchedule,
} from './budget-period';
import { Category } from './category';
import { Either, left, right } from './either';
import { Transaction } from './transaction';
import { ChangesTracker } from './changes-tracker';
import {
  CardInvoice,
  computeInvoiceBreakdown,
  INVOICE_REMAINDER_DESCRIPTION,
  InvoiceBreakdown,
} from './card-invoice';

// Interfaces para serialização
export interface SerializedCategory {
  id: string;
  name: string;
  code: string;
  description?: string;
}

export interface SerializedTransaction {
  id: string;
  code: string;
  amount: number;
  isCommitted: boolean;
  description?: string;
  createdAt: string; // Date como string JSON
  date: string; // Date como string JSON
  categoryId: string | null;
  type: 'expense' | 'income';
  vaultId: string;
}

export interface SerializedBox {
  id: string;
  name: string;
  goalAmount: number | null;
  isDefault: boolean;
  type: BoxType;
  balance: number;
  goalProgress: number;
}

export interface SerializedVault {
  id: string;
  token: string;
  balance: number;
  customPrompt: string;
  createdAt: string;
  transactions: [string, SerializedTransaction][];
  budgets: [string, { category: SerializedCategory; amount: number }][];
  boxes: SerializedBox[];
  totalBudgetedAmount: number;
  percentageTotalBudgetedAmount: number;
  totalSpentAmount: number;
  totalIncomeAmount: number;
  totalPlannedExpenses: number;
  budgetsSummary: BudgetSummary[];
  budgetStartDay: number;
  budgetStartDayOverrides: BudgetStartDayOverride[];
}

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

  public isDirty = false;
  readonly transactionsTracker = new ChangesTracker<Transaction>();
  readonly budgetsTracker = new ChangesTracker<{
    category: Category;
    amount: number;
  }>();
  readonly boxesTracker = new ChangesTracker<Box>();
  readonly invoicesTracker = new ChangesTracker<CardInvoice>();

  constructor(
    public readonly id = Vault.generateId(),
    public readonly token = Vault.generateToken(),
    public readonly createdAt: Date = new Date(),
    public readonly transactions: Map<string, Transaction> = new Map(),
    public readonly budgets: Map<
      string,
      { category: Category; amount: number }
    > = new Map(),
    public readonly boxes: Map<string, Box> = new Map(),
    private customPrompt = '',
    private _schedule: BudgetStartDaySchedule = {
      defaultDay: 1,
      overrides: [],
    },
    public readonly invoices: Map<string, CardInvoice> = new Map(),
  ) {}

  get schedule(): BudgetStartDaySchedule {
    return this._schedule;
  }

  get budgetStartDay(): number {
    return this._schedule.defaultDay;
  }

  get budgetStartDayOverrides(): BudgetStartDayOverride[] {
    return this._schedule.overrides;
  }

  setSchedule(input: unknown): Either<string, BudgetStartDaySchedule> {
    const [err, schedule] = validateSchedule(input);
    if (err !== null) return left(err);
    this._schedule = schedule;
    this.isDirty = true;
    return right(schedule);
  }

  getBudgetPeriod(
    month: number,
    year: number,
  ): { startDate: Date; endDate: Date } {
    return getBudgetPeriodFromSchedule(this._schedule, year, month);
  }

  isDateInBudgetPeriod(date: Date, month: number, year: number): boolean {
    return isDateInBudgetPeriodFromSchedule(this._schedule, date, year, month);
  }

  getCurrentBudgetPeriod(now?: Date): { month: number; year: number } {
    return getCurrentBudgetPeriodFromSchedule(this._schedule, now);
  }

  static create(): Vault {
    return new Vault(Vault.generateId(), Vault.generateToken(), new Date());
  }

  editCustomPrompt(prompt: string): void {
    this.customPrompt = prompt;
    this.isDirty = true;
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
    id: string,
    options: {
      amount?: number;
      description?: string;
      /** null removes the category. */
      categoryId?: string | null;
      date?: Date;
      type?: 'income' | 'expense';
      boxId?: string;
      allocationId?: string | null;
      withdrawalType?: 'withdrawal' | 'realization' | null;
    },
  ): Either<string, Transaction> {
    const transaction = this.transactions.get(id);
    if (!transaction) return left('Transação não encontrada');
    if (transaction.isInvoiceRemainder) {
      return left(
        'O valor não discriminado é calculado pela fatura: importe o extrato do cartão para detalhá-lo, ou exclua a fatura',
      );
    }

    if (options.boxId !== undefined) {
      if (!this.boxes.get(options.boxId)) {
        return left('Estrato não encontrado');
      }
      transaction.boxId = options.boxId;
    }

    if (options.amount !== undefined) {
      transaction.amount = options.amount;
    }
    if (options.description !== undefined) {
      transaction.description = options.description;
    }
    if (options.categoryId !== undefined) {
      transaction.categoryId = options.categoryId;
    }
    if (options.date !== undefined) {
      // Compra ligada a uma fatura conta na data de pagamento dela; a data que
      // o usuário vê e corrige é a da compra.
      if (transaction.isInvoicePurchase)
        transaction.purchaseDate = options.date;
      else transaction.date = options.date;
    }

    if (options.allocationId !== undefined) {
      transaction.allocationId = options.allocationId;
    }
    if (options.withdrawalType !== undefined) {
      transaction.withdrawalType = options.withdrawalType;
    }

    if (options.type !== undefined) {
      if (options.type !== 'income' && options.type !== 'expense') {
        return left(
          'Tipo de transação inválido. Deve ser "income" ou "expense".',
        );
      }
      transaction.type = options.type;
    }

    this.transactionsTracker.registerDirty(transaction);
    if (transaction.invoiceId) this.recomputeInvoice(transaction.invoiceId);
    return right(transaction);
  }

  /**
   * Excluir o não discriminado de uma fatura é excluir a fatura: ele não existe
   * sem ela. Excluir uma compra ligada faz o não discriminado crescer de volta.
   */
  deleteTransaction(id: string): Either<string, boolean> {
    const transaction = this.transactions.get(id);
    if (!transaction) return left('Transação não encontrada');
    if (transaction.isInvoiceRemainder) {
      return this.deleteInvoice(transaction.invoiceId!);
    }
    this.transactions.delete(transaction.id);
    this.transactionsTracker.registerDeleted(transaction);
    if (transaction.invoiceId) this.recomputeInvoice(transaction.invoiceId);
    return right(true);
  }

  /**
   * Registra uma fatura paga. Ela conta como gasto desde já: o que nenhuma
   * compra ligada detalhou vira a transação "não discriminado", no estrato que
   * pagou e na data do pagamento.
   */
  registerInvoice(input: {
    amount: number;
    paymentDate: Date;
    boxId: string;
    cardLabel?: string | null;
  }): Either<string, CardInvoice> {
    if (!(input.amount > 0)) return left('O valor da fatura deve ser positivo');
    if (!this.boxes.get(input.boxId)) return left('Estrato não encontrado');

    const invoice = CardInvoice.create({
      vaultId: this.id,
      boxId: input.boxId,
      amount: input.amount,
      paymentDate: input.paymentDate,
      cardLabel: input.cardLabel ?? null,
    });
    this.invoices.set(invoice.id, invoice);
    this.invoicesTracker.registerNew(invoice);
    this.recomputeInvoice(invoice.id);
    return right(invoice);
  }

  /**
   * Liga uma compra do cartão a uma fatura. A compra passa a contar na data de
   * pagamento da fatura, no estrato que pagou, e abate o não discriminado. A
   * data da compra fica guardada em `purchaseDate`.
   */
  linkToInvoice(
    transactionId: string,
    invoiceId: string,
  ): Either<string, true> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return left('Transação não encontrada');
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return left('Fatura não encontrada');
    if (transaction.transferId || transaction.isInvoiceRemainder) {
      return left('Só compras podem ser ligadas a uma fatura');
    }
    if (transaction.invoiceId === invoiceId) return right(true);

    if (transaction.invoiceId) this.unlinkFromInvoice(transactionId);

    transaction.purchaseDate = transaction.date;
    transaction.date = invoice.paymentDate;
    transaction.boxId = invoice.boxId;
    transaction.invoiceId = invoiceId;
    this.transactionsTracker.registerDirty(transaction);
    this.recomputeInvoice(invoiceId);
    return right(true);
  }

  /** Desfaz o vínculo: a compra volta a contar na data em que foi feita. */
  unlinkFromInvoice(transactionId: string): Either<string, true> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction?.isInvoicePurchase) {
      return left('A transação não está ligada a uma fatura');
    }
    const invoiceId = transaction.invoiceId!;
    transaction.date = transaction.purchaseDate!;
    transaction.purchaseDate = null;
    transaction.invoiceId = null;
    this.transactionsTracker.registerDirty(transaction);
    this.recomputeInvoice(invoiceId);
    return right(true);
  }

  /**
   * Remove a fatura e o não discriminado dela. As compras ligadas continuam
   * existindo e voltam a contar na data da compra.
   */
  deleteInvoice(invoiceId: string): Either<string, boolean> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return left('Fatura não encontrada');

    for (const tx of [...this.transactions.values()]) {
      if (tx.invoiceId !== invoiceId) continue;
      if (tx.isInvoiceRemainder) {
        this.transactions.delete(tx.id);
        this.transactionsTracker.registerDeleted(tx);
      } else {
        tx.date = tx.purchaseDate!;
        tx.purchaseDate = null;
        tx.invoiceId = null;
        this.transactionsTracker.registerDirty(tx);
      }
    }
    this.invoices.delete(invoiceId);
    this.invoicesTracker.registerDeleted(invoice);
    return right(true);
  }

  getInvoiceBreakdown(invoiceId: string): InvoiceBreakdown | null {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return null;
    return computeInvoiceBreakdown(
      invoice.amount,
      this.invoicePurchases(invoiceId),
    );
  }

  private invoicePurchases(invoiceId: string): Transaction[] {
    return [...this.transactions.values()].filter(
      (tx) => tx.invoiceId === invoiceId && tx.isInvoicePurchase,
    );
  }

  /**
   * Mantém o não discriminado igual a `valor pago − compras ligadas`. Quando
   * chega a zero a transação é removida — uma despesa de R$ 0 só poluiria as
   * listas — e volta a existir se o valor crescer de novo (uma compra excluída
   * ou desligada). Compras além do valor pago não geram valor negativo: o
   * excesso aparece em `getInvoiceBreakdown`.
   */
  private recomputeInvoice(invoiceId: string): void {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return;
    const { remainder } = computeInvoiceBreakdown(
      invoice.amount,
      this.invoicePurchases(invoiceId),
    );
    const current = [...this.transactions.values()].find(
      (tx) => tx.invoiceId === invoiceId && tx.isInvoiceRemainder,
    );

    if (remainder === 0) {
      if (current) {
        this.transactions.delete(current.id);
        this.transactionsTracker.registerDeleted(current);
      }
      return;
    }

    if (current) {
      if (current.amount !== remainder) {
        current.amount = remainder;
        this.transactionsTracker.registerDirty(current);
      }
      return;
    }

    const created = Transaction.create({
      vaultId: this.id,
      amount: remainder,
      type: 'expense',
      date: invoice.paymentDate,
      boxId: invoice.boxId,
      description: INVOICE_REMAINDER_DESCRIPTION,
      categoryId: null,
      invoiceId,
    });
    this.addTransaction(created);
    this.commitTransaction(created.id);
  }

  private isSpendingTransaction(transaction: Transaction): boolean {
    const box = transaction.boxId
      ? this.boxes.get(transaction.boxId)
      : undefined;
    return !box || box.type !== 'saving';
  }

  private isCrossTypeTransfer(transferId: string): boolean {
    let expenseBoxType: 'spending' | 'saving' = 'spending';
    let incomeBoxType: 'spending' | 'saving' = 'spending';

    for (const tx of this.transactions.values()) {
      if (tx.transferId !== transferId) continue;
      const box = tx.boxId ? this.boxes.get(tx.boxId) : undefined;
      const boxType = box?.type ?? 'spending';
      if (tx.type === 'expense') expenseBoxType = boxType;
      else incomeBoxType = boxType;
    }

    return expenseBoxType !== incomeBoxType;
  }

  getBalance(options?: { includeAll?: boolean }): number {
    const sumOrSubtract = (
      type: 'income' | 'expense',
      amount: number,
    ): number => {
      return type === 'income' ? amount : -amount;
    };
    let total = 0;
    for (const transaction of this.transactions.values()) {
      if (!transaction.isCommitted) continue;
      if (!options?.includeAll && !this.isSpendingTransaction(transaction))
        continue;
      total += sumOrSubtract(transaction.type, transaction.amount);
    }
    return total;
  }

  addBox(box: Box): void {
    this.boxes.set(box.id, box);
    this.boxesTracker.registerNew(box);
  }

  editBox(
    boxId: string,
    options: { name?: string; goalAmount?: number | null; type?: BoxType },
  ): Either<string, Box> {
    const box = this.boxes.get(boxId);
    if (!box) return left('Estrato não encontrado');
    if (options.name !== undefined) box.name = options.name;
    if (options.goalAmount !== undefined) box.goalAmount = options.goalAmount;
    if (options.type !== undefined) box.type = options.type;
    this.boxesTracker.registerDirty(box);
    return right(box);
  }

  deleteBox(boxId: string): Either<string, boolean> {
    const box = this.boxes.get(boxId);
    if (!box) return left('Estrato não encontrado');
    if (box.isDefault) return left('Não é possível deletar o estrato padrão');
    for (const tx of this.transactions.values()) {
      if (tx.boxId === boxId)
        return left('Não é possível deletar um estrato com transações');
    }
    this.boxes.delete(boxId);
    this.boxesTracker.registerDeleted(box);
    return right(true);
  }

  getBoxBalance(boxId: string): number {
    let total = 0;
    for (const tx of this.transactions.values()) {
      if (tx.boxId !== boxId || !tx.isCommitted) continue;
      total += tx.type === 'income' ? tx.amount : -tx.amount;
    }
    return total;
  }

  createTransfer(input: {
    fromBoxId: string;
    toBoxId: string;
    amount: number;
    date: Date;
  }): Either<string, string> {
    const fromBox = this.boxes.get(input.fromBoxId);
    const toBox = this.boxes.get(input.toBoxId);
    if (!fromBox) return left('Estrato de origem não encontrado');
    if (!toBox) return left('Estrato de destino não encontrado');
    if (input.fromBoxId === input.toBoxId)
      return left('Não é possível transferir para o mesmo estrato');

    const transferId = crypto.randomUUID();

    const expenseTx = Transaction.create({
      amount: input.amount,
      vaultId: this.id,
      boxId: input.fromBoxId,
      type: 'expense',
      date: input.date,
      transferId,
    });

    const incomeTx = Transaction.create({
      amount: input.amount,
      vaultId: this.id,
      boxId: input.toBoxId,
      type: 'income',
      date: input.date,
      transferId,
    });

    this.addTransaction(expenseTx);
    this.commitTransaction(expenseTx.id);
    this.addTransaction(incomeTx);
    this.commitTransaction(incomeTx.id);

    return right(transferId);
  }

  editTransfer(
    transferId: string,
    options: {
      amount?: number;
      date?: Date;
      fromBoxId?: string;
      toBoxId?: string;
    },
  ): Either<string, boolean> {
    const transferTxs: Transaction[] = [];
    for (const tx of this.transactions.values()) {
      if (tx.transferId === transferId) transferTxs.push(tx);
    }
    if (transferTxs.length === 0) return left('Transferência não encontrada');

    const expenseTx = transferTxs.find((tx) => tx.type === 'expense');
    const incomeTx = transferTxs.find((tx) => tx.type === 'income');
    if (!expenseTx || !incomeTx) return left('Transferência inválida');

    // Validate all inputs before mutating
    if (options.fromBoxId !== undefined && !this.boxes.get(options.fromBoxId)) {
      return left('Estrato de origem não encontrado');
    }
    if (options.toBoxId !== undefined && !this.boxes.get(options.toBoxId)) {
      return left('Estrato de destino não encontrado');
    }

    const nextFromBoxId = options.fromBoxId ?? expenseTx.boxId;
    const nextToBoxId = options.toBoxId ?? incomeTx.boxId;
    if (nextFromBoxId === nextToBoxId) {
      return left('Não é possível transferir para o mesmo estrato');
    }

    // Apply mutations after all validations pass
    if (options.fromBoxId !== undefined) expenseTx.boxId = options.fromBoxId;
    if (options.toBoxId !== undefined) incomeTx.boxId = options.toBoxId;

    if (options.amount !== undefined) {
      expenseTx.amount = options.amount;
      incomeTx.amount = options.amount;
    }

    if (options.date !== undefined) {
      expenseTx.date = options.date;
      incomeTx.date = options.date;
    }

    this.transactionsTracker.registerDirty(expenseTx);
    this.transactionsTracker.registerDirty(incomeTx);
    return right(true);
  }

  deleteTransfer(transferId: string): Either<string, boolean> {
    const transferTxs: Transaction[] = [];
    for (const tx of this.transactions.values()) {
      if (tx.transferId === transferId) transferTxs.push(tx);
    }
    if (transferTxs.length === 0) return left('Transferência não encontrada');
    for (const tx of transferTxs) {
      this.transactions.delete(tx.id);
      this.transactionsTracker.registerDeleted(tx);
    }
    return right(true);
  }

  setBudget(category: Category, amount: number): Either<string, boolean> {
    if (amount < 0) {
      return left('O valor do orçamento não pode ser negativo');
    }
    const existingBudget = this.budgets.get(category.id);
    this.budgets.set(category.id, { category, amount });

    if (existingBudget) {
      // Budget already exists, register as dirty (update)
      this.budgetsTracker.registerDirty({
        category,
        amount,
      });
    } else {
      // New budget, register as new (insert)
      this.budgetsTracker.registerNew({
        category,
        amount,
      });
    }
    return right(true);
  }

  getBudgetsSummary(month?: number, year?: number): BudgetSummary[] {
    const summary: BudgetSummary[] = [];

    for (const [categoryId, budget] of this.budgets.entries()) {
      const spent = Array.from(this.transactions.values())
        .filter((transaction) => {
          if (
            transaction.categoryId !== categoryId ||
            transaction.type !== 'expense' ||
            transaction.transferId ||
            transaction.allocationId
          ) {
            return false;
          }

          // If month and year are provided, check against budget period
          if (month && year) {
            const transactionDate = new Date(transaction.date);
            return this.isDateInBudgetPeriod(transactionDate, month, year);
          }

          return true;
        })
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
  totalSpentAmount(
    date?: { month: number; year: number },
    options?: { includeAll?: boolean },
  ): number {
    let total = 0;
    if (!date) {
      date = this.getCurrentBudgetPeriod();
    }

    for (const transaction of this.transactions.values()) {
      if (transaction.type !== 'expense') continue;
      if (transaction.allocationId) continue;

      if (transaction.transferId) {
        // includeAll: exclude all transfers (they cancel out vault-wide)
        if (options?.includeAll) continue;
        // spending-only: include cross-type transfers from spending boxes
        if (!this.isSpendingTransaction(transaction)) continue;
        if (!this.isCrossTypeTransfer(transaction.transferId)) continue;
      } else {
        if (!options?.includeAll && !this.isSpendingTransaction(transaction))
          continue;
      }

      const transactionDate = new Date(transaction.date);
      if (this.isDateInBudgetPeriod(transactionDate, date.month, date.year)) {
        total += Math.abs(transaction.amount);
      }
    }
    return total;
  }

  totalIncomeAmount(
    date?: { month: number; year: number },
    options?: { includeAll?: boolean },
  ): number {
    let total = 0;
    if (!date) {
      date = this.getCurrentBudgetPeriod();
    }

    for (const transaction of this.transactions.values()) {
      if (transaction.type !== 'income') continue;

      if (transaction.transferId) {
        if (options?.includeAll) continue;
        if (!this.isSpendingTransaction(transaction)) continue;
        if (!this.isCrossTypeTransfer(transaction.transferId)) continue;
      } else {
        if (!options?.includeAll && !this.isSpendingTransaction(transaction))
          continue;
      }

      const transactionDate = new Date(transaction.date);
      if (this.isDateInBudgetPeriod(transactionDate, date.month, date.year)) {
        total += transaction.amount;
      }
    }
    return total;
  }

  totalPlannedExpenses(date?: { month: number; year: number }): number {
    let total = 0;
    if (!date) {
      date = this.getCurrentBudgetPeriod();
    }

    // Planned expenses are always in spending boxes (direct expense tagged with allocationId).
    // No isSpendingTransaction check needed — unlike totalSpentAmount which handles cross-type transfers.
    for (const transaction of this.transactions.values()) {
      if (transaction.type !== 'expense') continue;
      if (!transaction.allocationId) continue;

      const transactionDate = new Date(transaction.date);
      if (this.isDateInBudgetPeriod(transactionDate, date.month, date.year)) {
        total += Math.abs(transaction.amount);
      }
    }
    return total;
  }

  getCustomPrompt(): string {
    return this.customPrompt;
  }

  clearChanges(): void {
    this.transactionsTracker.clearChanges();
    this.budgetsTracker.clearChanges();
    this.boxesTracker.clearChanges();
    this.invoicesTracker.clearChanges();
    this.isDirty = false;
  }

  /**
   * Serializa o vault no formato necessário para o front-end
   * @returns SerializedVault - Representação serializada do vault
   */
  toJSON(
    options: {
      date?: { month: number; year: number };
    } = {},
  ): SerializedVault {
    // Serializar transações
    const serializedTransactions: [string, SerializedTransaction][] =
      Array.from(this.transactions.entries()).map(([id, transaction]) => [
        id,
        {
          id: transaction.id,
          code: transaction.code,
          amount: transaction.amount,
          isCommitted: transaction.isCommitted,
          description: transaction.description,
          createdAt: transaction.createdAt.toISOString(),
          date: transaction.date.toISOString(),
          categoryId: transaction.categoryId,
          type: transaction.type,
          vaultId: transaction.vaultId,
        },
      ]);

    // Serializar orçamentos
    const serializedBudgets: [
      string,
      { category: SerializedCategory; amount: number },
    ][] = Array.from(this.budgets.entries()).map(([id, budget]) => [
      id,
      {
        category: {
          id: budget.category.id,
          name: budget.category.name,
          code: budget.category.code,
          description: budget.category.description,
        },
        amount: budget.amount,
      },
    ]);

    // Serializar estratos
    const serializedBoxes: SerializedBox[] = Array.from(
      this.boxes.values(),
    ).map((box) => {
      const balance = this.getBoxBalance(box.id);
      const goalProgress =
        box.goalAmount && box.goalAmount > 0
          ? (balance / box.goalAmount) * 100
          : 0;
      return {
        id: box.id,
        name: box.name,
        goalAmount: box.goalAmount,
        isDefault: box.isDefault,
        type: box.type,
        balance,
        goalProgress,
      };
    });

    return {
      id: this.id,
      token: this.token,
      customPrompt: this.customPrompt,
      createdAt: this.createdAt.toISOString(),
      transactions: serializedTransactions,
      budgets: serializedBudgets,
      boxes: serializedBoxes,
      balance: this.getBalance(),
      totalBudgetedAmount: this.totalBudgetedAmount(),
      percentageTotalBudgetedAmount: this.percentageTotalBudgetedAmount(),
      totalSpentAmount: this.totalSpentAmount(options.date),
      totalIncomeAmount: this.totalIncomeAmount(options.date),
      totalPlannedExpenses: this.totalPlannedExpenses(options.date),
      budgetsSummary: this.getBudgetsSummary(
        options.date?.month,
        options.date?.year,
      ),
      budgetStartDay: this._schedule.defaultDay,
      budgetStartDayOverrides: this._schedule.overrides,
    };
  }
}
