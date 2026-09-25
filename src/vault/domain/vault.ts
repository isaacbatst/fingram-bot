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
  allocateCard,
  CardAllocation,
  CardInvoice,
  CardPayment,
  computeInvoiceFigures,
  InvoiceFigures,
  invoiceRemainderDescription,
  toCents,
} from './card-invoice';
import {
  addDays,
  Card,
  cycleDatesFor,
  dueDateAfter,
  startOfUtcDay,
  validateCardDay,
} from './card';

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
/**
 * Até quantos dias o débito importado pode estar da data de um pagamento
 * informado à mão para ser reconhecido como a linha dele.
 */
const PAYMENT_MATCH_DAYS = 7;
/** Um pagamento até estes dias depois do vencimento ainda paga aquela fatura. */
const PAYMENT_GRACE_DAYS = 10;
/** Distância máxima entre o `DTEND` do extrato e o fechamento da fatura. */
const STATEMENT_MATCH_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Por que uma linha derivada da fatura não pode ser editada nem excluída
 * direto, e o que fazer no lugar. Null para as demais transações.
 */
export function derivedTransactionError(transaction: Transaction): string | null {
  if (transaction.isInvoicePart) {
    return `Esta transação é a parte de uma compra de cartão paga por um pagamento de fatura, e é recalculada sozinha. Edite ou exclua a compra (id ${transaction.sourceTransactionId}).`;
  }
  if (transaction.isInvoiceRemainder) {
    return `Este é o não discriminado de um pagamento de fatura: encolhe sozinho conforme as compras do cartão chegam. Para mudar o valor, edite ou exclua o pagamento (id ${transaction.paymentId}).`;
  }
  return null;
}

type DerivedSpec = {
  amount: number;
  date: Date;
  boxId: string;
  categoryId: string | null;
  allocationId: string | null;
  withdrawalType: 'withdrawal' | 'realization' | null;
  description: string;
  purchaseDate: Date | null;
  sourceTransactionId: string | null;
  paymentId: string;
  invoiceId: string;
};

/** Aplica os campos calculados numa linha derivada. Diz se algo mudou. */
function applySpec(tx: Transaction, spec: DerivedSpec): boolean {
  let changed = false;
  const set = <K extends keyof DerivedSpec & keyof Transaction>(key: K) => {
    const current = tx[key] as unknown;
    const next = spec[key] as unknown;
    const same =
      current instanceof Date && next instanceof Date
        ? current.getTime() === next.getTime()
        : current === next;
    if (!same) {
      (tx as unknown as Record<string, unknown>)[key] = next;
      changed = true;
    }
  };
  set('amount');
  set('date');
  set('boxId');
  set('categoryId');
  set('allocationId');
  set('withdrawalType');
  set('description');
  set('purchaseDate');
  set('sourceTransactionId');
  set('paymentId');
  set('invoiceId');
  return changed;
}

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
  readonly cardsTracker = new ChangesTracker<Card>();
  readonly invoicesTracker = new ChangesTracker<CardInvoice>();
  readonly paymentsTracker = new ChangesTracker<CardPayment>();

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
    public readonly cards: Map<string, Card> = new Map(),
    public readonly payments: Map<string, CardPayment> = new Map(),
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
    const derivedError = derivedTransactionError(transaction);
    if (derivedError) return left(derivedError);

    if (options.boxId !== undefined) {
      if (!this.boxes.get(options.boxId)) {
        return left('Estrato não encontrado');
      }
      if (transaction.isCardPurchase && options.boxId !== transaction.boxId) {
        return left(
          'A compra de cartão sai do estrato pagador do cartão: troque o estrato no cartão',
        );
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
      transaction.date = options.date;
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
    if (transaction.isCardPurchase) this.recomputeInvoiceCard(transaction);
    return right(transaction);
  }

  /**
   * Partes e não discriminado são derivados de compras e pagamentos: não se
   * excluem diretamente. Excluir uma compra de cartão refaz as partes.
   */
  deleteTransaction(id: string): Either<string, boolean> {
    const transaction = this.transactions.get(id);
    if (!transaction) return left('Transação não encontrada');
    const derivedError = derivedTransactionError(transaction);
    if (derivedError) return left(derivedError);
    this.transactions.delete(transaction.id);
    this.transactionsTracker.registerDeleted(transaction);
    if (transaction.isCardPurchase) this.recomputeInvoiceCard(transaction);
    return right(true);
  }

  // ---------------------------------------------------------------------------
  // Cartões, faturas (ciclos) e pagamentos. Ver spec-operational §9.
  // ---------------------------------------------------------------------------

  private defaultBoxId(): string | undefined {
    return [...this.boxes.values()].find((b) => b.isDefault)?.id;
  }

  addCard(input: {
    name: string;
    closingDay: number;
    dueDay: number;
    boxId?: string;
    accountKey?: string | null;
  }): Either<string, Card> {
    const boxId = input.boxId ?? this.defaultBoxId();
    if (!boxId || !this.boxes.get(boxId)) return left('Estrato não encontrado');
    if (input.accountKey && this.findCardByAccountKey(input.accountKey)) {
      return left('Já existe um cartão para esta conta do extrato');
    }
    const [error, card] = Card.create({
      vaultId: this.id,
      name: input.name,
      closingDay: input.closingDay,
      dueDay: input.dueDay,
      boxId,
      accountKey: input.accountKey ?? null,
    });
    if (error !== null) return left(error);
    this.cards.set(card.id, card);
    this.cardsTracker.registerNew(card);
    return right(card);
  }

  /**
   * Os dias novos valem para os ciclos criados daqui em diante; as faturas que
   * já existem mantêm as datas delas (edite-as com `updateInvoice`). Trocar o
   * estrato pagador move as compras; os pagamentos já feitos continuam no
   * estrato de onde o dinheiro saiu.
   */
  updateCard(
    cardId: string,
    changes: {
      name?: string;
      closingDay?: number;
      dueDay?: number;
      boxId?: string;
      accountKey?: string | null;
    },
  ): Either<string, Card> {
    const card = this.cards.get(cardId);
    if (!card) return left('Cartão não encontrado');
    if (changes.name !== undefined && !changes.name.trim()) {
      return left('O nome do cartão é obrigatório');
    }
    const dayError =
      (changes.closingDay !== undefined
        ? validateCardDay(changes.closingDay, 'fechamento')
        : null) ??
      (changes.dueDay !== undefined
        ? validateCardDay(changes.dueDay, 'vencimento')
        : null);
    if (dayError) return left(dayError);
    if (changes.boxId !== undefined && !this.boxes.get(changes.boxId)) {
      return left('Estrato não encontrado');
    }
    if (changes.accountKey) {
      const other = this.findCardByAccountKey(changes.accountKey);
      if (other && other.id !== cardId) {
        return left('Já existe um cartão para esta conta do extrato');
      }
    }

    if (changes.name !== undefined) card.name = changes.name.trim();
    if (changes.closingDay !== undefined) card.closingDay = changes.closingDay;
    if (changes.dueDay !== undefined) card.dueDay = changes.dueDay;
    if (changes.accountKey !== undefined) card.accountKey = changes.accountKey;
    if (changes.boxId !== undefined && changes.boxId !== card.boxId) {
      card.boxId = changes.boxId;
      for (const tx of this.purchasesOfCard(cardId)) {
        tx.boxId = changes.boxId;
        this.transactionsTracker.registerDirty(tx);
      }
    }
    this.cardsTracker.registerDirty(card);
    // O nome entra na descrição do não discriminado.
    this.recomputeCard(cardId);
    return right(card);
  }

  /** Só um cartão sem compras nem pagamentos: o histórico não se perde por engano. */
  deleteCard(cardId: string): Either<string, true> {
    const card = this.cards.get(cardId);
    if (!card) return left('Cartão não encontrado');
    const invoices = this.invoicesOfCard(cardId);
    const ids = new Set(invoices.map((i) => i.id));
    const used =
      this.purchasesOfCard(cardId).length > 0 ||
      [...this.payments.values()].some((p) => ids.has(p.invoiceId));
    if (used) {
      return left(
        'O cartão tem compras ou pagamentos de fatura: desligue as compras e exclua os pagamentos antes',
      );
    }
    for (const invoice of invoices) {
      this.invoices.delete(invoice.id);
      this.invoicesTracker.registerDeleted(invoice);
    }
    this.cards.delete(cardId);
    this.cardsTracker.registerDeleted(card);
    return right(true);
  }

  findCardByAccountKey(accountKey: string): Card | null {
    return (
      [...this.cards.values()].find((c) => c.accountKey === accountKey) ?? null
    );
  }

  /** Faturas do cartão, da mais antiga para a mais nova. */
  invoicesOfCard(cardId: string): CardInvoice[] {
    return [...this.invoices.values()]
      .filter((i) => i.cardId === cardId)
      .sort((a, b) => a.closingDate.getTime() - b.closingDate.getTime());
  }

  private purchasesOfCard(cardId: string): Transaction[] {
    const ids = new Set(this.invoicesOfCard(cardId).map((i) => i.id));
    return [...this.transactions.values()].filter(
      (tx) => tx.isCardPurchase && tx.invoiceId && ids.has(tx.invoiceId),
    );
  }

  paymentsOfCard(cardId: string): CardPayment[] {
    const ids = new Set(this.invoicesOfCard(cardId).map((i) => i.id));
    return [...this.payments.values()].filter((p) => ids.has(p.invoiceId));
  }

  cardOfInvoice(invoiceId: string): Card | null {
    const invoice = this.invoices.get(invoiceId);
    return invoice ? (this.cards.get(invoice.cardId) ?? null) : null;
  }

  /**
   * A fatura do cartão que contém a data, criada pelos dias do cartão se ainda
   * não existir. Uma fatura nova nunca invade o período das vizinhas (que podem
   * ter vindo de um extrato, com datas próprias).
   */
  invoiceFor(
    cardId: string,
    date: Date,
    options: { dryRun?: boolean } = {},
  ): Either<string, CardInvoice> {
    const card = this.cards.get(cardId);
    if (!card) return left('Cartão não encontrado');
    const day = startOfUtcDay(date);
    const invoices = this.invoicesOfCard(cardId);
    const existing = invoices.find((i) => i.contains(day));
    if (existing) return right(existing);

    const dates = cycleDatesFor(card, day);
    let periodStart = dates.periodStart;
    let closingDate = dates.closingDate;
    for (const other of invoices) {
      if (
        other.closingDate.getTime() < day.getTime() &&
        other.closingDate.getTime() >= periodStart.getTime()
      ) {
        periodStart = addDays(other.closingDate, 1);
      }
      if (
        other.periodStart.getTime() > day.getTime() &&
        other.periodStart.getTime() <= closingDate.getTime()
      ) {
        closingDate = addDays(other.periodStart, -1);
      }
    }
    const invoice = CardInvoice.create({
      vaultId: this.id,
      cardId,
      periodStart,
      closingDate,
      dueDate: dueDateAfter(closingDate, card.dueDay),
    });
    // Numa consulta (dryRun) a fatura sugerida não entra no agregado.
    if (options.dryRun) return right(invoice);
    this.invoices.set(invoice.id, invoice);
    this.invoicesTracker.registerNew(invoice);
    return right(invoice);
  }

  /**
   * A fatura que um extrato de cartão detalha. O período do extrato manda:
   * uma fatura com fechamento a até 5 dias do `DTEND` é ajustada a ele; senão
   * uma nova é criada com o período do arquivo.
   */
  statementInvoice(
    cardId: string,
    period: { periodStart: Date | null; periodEnd: Date | null },
    fallbackDate: Date,
  ): Either<string, CardInvoice> {
    const card = this.cards.get(cardId);
    if (!card) return left('Cartão não encontrado');
    if (!period.periodEnd) return this.invoiceFor(cardId, fallbackDate);

    const periodEnd = startOfUtcDay(period.periodEnd);
    const periodStart = period.periodStart
      ? startOfUtcDay(period.periodStart)
      : null;
    const match = this.invoicesOfCard(cardId).find(
      (i) =>
        Math.abs(i.closingDate.getTime() - periodEnd.getTime()) <=
        STATEMENT_MATCH_DAYS * DAY_MS,
    );
    if (match) {
      match.closingDate = periodEnd;
      if (periodStart && periodStart.getTime() <= periodEnd.getTime()) {
        match.periodStart = periodStart;
      }
      if (match.dueDate.getTime() <= periodEnd.getTime()) {
        match.dueDate = dueDateAfter(periodEnd, card.dueDay);
      }
      this.invoicesTracker.registerDirty(match);
      this.recomputeCard(cardId);
      return right(match);
    }

    const invoice = CardInvoice.create({
      vaultId: this.id,
      cardId,
      periodStart:
        periodStart && periodStart.getTime() <= periodEnd.getTime()
          ? periodStart
          : cycleDatesFor(card, periodEnd).periodStart,
      closingDate: periodEnd,
      dueDate: dueDateAfter(periodEnd, card.dueDay),
    });
    this.invoices.set(invoice.id, invoice);
    this.invoicesTracker.registerNew(invoice);
    this.recomputeCard(cardId);
    return right(invoice);
  }

  updateInvoice(
    invoiceId: string,
    changes: {
      periodStart?: Date;
      closingDate?: Date;
      dueDate?: Date;
      closed?: boolean;
    },
  ): Either<string, CardInvoice> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return left('Fatura não encontrada');
    const periodStart = changes.periodStart ?? invoice.periodStart;
    const closingDate = changes.closingDate ?? invoice.closingDate;
    const dueDate = changes.dueDate ?? invoice.dueDate;
    if (periodStart.getTime() > closingDate.getTime()) {
      return left('O início do período deve ser até a data de fechamento');
    }
    if (dueDate.getTime() <= closingDate.getTime()) {
      return left('O vencimento deve ser depois do fechamento');
    }
    invoice.periodStart = periodStart;
    invoice.closingDate = closingDate;
    invoice.dueDate = dueDate;
    if (changes.closed !== undefined) invoice.closed = changes.closed;
    this.invoicesTracker.registerDirty(invoice);
    this.recomputeCard(invoice.cardId);
    return right(invoice);
  }

  /**
   * Fecha a fatura antes da data (ou na data informada). Compras novas do
   * cartão passam a cair na próxima.
   */
  closeInvoice(invoiceId: string, closingDate?: Date): Either<string, true> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return left('Fatura não encontrada');
    const [error] = this.updateInvoice(invoiceId, {
      closingDate,
      dueDate:
        closingDate && invoice.dueDate.getTime() <= closingDate.getTime()
          ? dueDateAfter(closingDate, this.cards.get(invoice.cardId)!.dueDay)
          : undefined,
      closed: true,
    });
    if (error !== null) return left(error);
    return right(true);
  }

  /**
   * A fatura que um pagamento feito na data provavelmente paga: a última
   * fechada antes dela, se o pagamento cai até alguns dias depois do
   * vencimento e ela ainda não está paga; senão a fatura em aberto na data
   * (pagamento antecipado). Uma sugestão — quem chama pode escolher outra.
   */
  suggestInvoiceForPayment(
    cardId: string,
    date: Date,
    options: { dryRun?: boolean } = {},
  ): Either<string, CardInvoice> {
    const card = this.cards.get(cardId);
    if (!card) return left('Cartão não encontrado');
    const day = startOfUtcDay(date);
    const inWindow = (closing: Date, due: Date) =>
      closing.getTime() < day.getTime() &&
      day.getTime() <= due.getTime() + PAYMENT_GRACE_DAYS * DAY_MS;

    const invoices = this.invoicesOfCard(cardId);
    const candidates = invoices.filter((i) =>
      inWindow(i.closingDate, i.dueDate),
    );
    if (candidates.length > 0) {
      const unpaid = candidates
        .reverse()
        // Sem compras ainda, o total é desconhecido (o extrato do cartão não
        // chegou): a fatura segue recebendo os pagamentos da janela.
        .find(
          (i) =>
            this.purchasesCents(i.id) === 0 ||
            this.paidCents(i.id) < this.purchasesCents(i.id),
        );
      if (unpaid) return right(unpaid);
      return this.invoiceFor(cardId, day, options);
    }

    // Uma fatura anterior que ainda não existe só é criada para o pagamento
    // feito até o vencimento dela; depois disso é antecipação da atual.
    const current = cycleDatesFor(card, day);
    const previous = cycleDatesFor(card, addDays(current.periodStart, -1));
    if (
      previous.closingDate.getTime() < day.getTime() &&
      day.getTime() <= previous.dueDate.getTime()
    ) {
      return this.invoiceFor(cardId, previous.closingDate, options);
    }
    return this.invoiceFor(cardId, day, options);
  }

  private paidCents(invoiceId: string): number {
    let total = 0;
    for (const p of this.payments.values()) {
      if (p.invoiceId === invoiceId) total += toCents(p.amount);
    }
    return total;
  }

  private purchasesCents(invoiceId: string): number {
    let total = 0;
    for (const tx of this.transactions.values()) {
      if (!tx.isCardPurchase || tx.invoiceId !== invoiceId) continue;
      total += tx.type === 'expense' ? toCents(tx.amount) : -toCents(tx.amount);
    }
    return total;
  }

  /**
   * Registra um pagamento de fatura. Sem `invoiceId`, a fatura é sugerida pela
   * data (`suggestInvoiceForPayment`). O valor passa a contar na data do
   * pagamento: as compras que ele cobre e, o que sobrar, não discriminado.
   */
  addPayment(input: {
    invoiceId?: string;
    cardId?: string;
    amount: number;
    date: Date;
    boxId?: string;
    imported?: boolean;
    importEntryId?: string | null;
  }): Either<string, CardPayment> {
    if (!(input.amount > 0)) return left('O valor do pagamento deve ser positivo');
    let invoice: CardInvoice | undefined;
    if (input.invoiceId) {
      invoice = this.invoices.get(input.invoiceId);
      if (!invoice) return left('Fatura não encontrada');
      if (input.cardId && invoice.cardId !== input.cardId) {
        return left('A fatura não é deste cartão');
      }
    } else if (input.cardId) {
      const [error, suggested] = this.suggestInvoiceForPayment(
        input.cardId,
        input.date,
      );
      if (error !== null) return left(error);
      invoice = suggested;
    } else {
      return left('Informe o cartão ou a fatura');
    }
    const card = this.cards.get(invoice.cardId)!;
    const boxId = input.boxId ?? card.boxId;
    if (!this.boxes.get(boxId)) return left('Estrato não encontrado');

    const payment = CardPayment.create({
      vaultId: this.id,
      invoiceId: invoice.id,
      boxId,
      amount: input.amount,
      date: input.date,
      imported: input.imported ?? false,
      importEntryId: input.importEntryId ?? null,
    });
    this.payments.set(payment.id, payment);
    this.paymentsTracker.registerNew(payment);
    this.recomputeCard(card.id);
    return right(payment);
  }

  updatePayment(
    paymentId: string,
    changes: {
      amount?: number;
      date?: Date;
      invoiceId?: string;
      boxId?: string;
    },
  ): Either<string, CardPayment> {
    const payment = this.payments.get(paymentId);
    if (!payment) return left('Pagamento não encontrado');
    if (changes.amount !== undefined && !(changes.amount > 0)) {
      return left('O valor do pagamento deve ser positivo');
    }
    if (changes.invoiceId !== undefined && !this.invoices.get(changes.invoiceId)) {
      return left('Fatura não encontrada');
    }
    if (changes.boxId !== undefined && !this.boxes.get(changes.boxId)) {
      return left('Estrato não encontrado');
    }
    const previousCardId = this.invoices.get(payment.invoiceId)!.cardId;
    if (changes.amount !== undefined) payment.amount = changes.amount;
    if (changes.date !== undefined) payment.date = changes.date;
    if (changes.invoiceId !== undefined) payment.invoiceId = changes.invoiceId;
    if (changes.boxId !== undefined) payment.boxId = changes.boxId;
    this.paymentsTracker.registerDirty(payment);
    const cardId = this.invoices.get(payment.invoiceId)!.cardId;
    this.recomputeCard(cardId);
    if (previousCardId !== cardId) this.recomputeCard(previousCardId);
    return right(payment);
  }

  /** Remove o pagamento e o que ele fazia contar (partes e não discriminado). */
  deletePayment(paymentId: string): Either<string, true> {
    const payment = this.payments.get(paymentId);
    if (!payment) return left('Pagamento não encontrado');
    const cardId = this.invoices.get(payment.invoiceId)!.cardId;
    this.payments.delete(paymentId);
    this.paymentsTracker.registerDeleted(payment);
    this.recomputeCard(cardId);
    return right(true);
  }

  /**
   * O pagamento informado à mão que espera por este débito importado: ainda
   * sem linha do extrato, mesmo estrato, mesmo valor ao centavo e até
   * `PAYMENT_MATCH_DAYS` dias de distância (o mais próximo). É o que impede o
   * débito de virar um segundo pagamento.
   */
  findPaymentAwaitingLine(line: {
    amount: number;
    date: Date;
    boxId: string;
  }): CardPayment | null {
    const cents = toCents(line.amount);
    const distance = (p: CardPayment) =>
      Math.abs(p.date.getTime() - line.date.getTime());
    const candidates = [...this.payments.values()].filter(
      (p) =>
        !p.imported &&
        p.boxId === line.boxId &&
        toCents(p.amount) === cents &&
        distance(p) <= PAYMENT_MATCH_DAYS * DAY_MS,
    );
    candidates.sort((a, b) => distance(a) - distance(b));
    return candidates[0] ?? null;
  }

  /** O débito importado chegou: a data do extrato passa a ser a real. */
  attachImportedLine(
    paymentId: string,
    line: { date: Date; importEntryId: string | null },
  ): Either<string, CardPayment> {
    const payment = this.payments.get(paymentId);
    if (!payment) return left('Pagamento não encontrado');
    if (payment.imported) return left('Este pagamento já tem o débito do extrato');
    payment.imported = true;
    payment.date = line.date;
    payment.importEntryId = line.importEntryId;
    this.paymentsTracker.registerDirty(payment);
    this.recomputeCard(this.invoices.get(payment.invoiceId)!.cardId);
    return right(payment);
  }

  /**
   * Faz de uma transação uma compra de cartão, numa fatura escolhida ou na do
   * cartão que contém a data dela. Ela deixa de contar na data da compra e
   * passa a contar pelas partes que os pagamentos pagam; enquanto nenhum paga,
   * fica "a pagar". Mudar de fatura (ou de cartão) não conta duas vezes.
   */
  linkPurchase(
    transactionId: string,
    target: { invoiceId: string } | { cardId: string },
  ): Either<string, Transaction> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return left('Transação não encontrada');
    if (transaction.transferId) {
      return left('Transferência entre estratos não entra em fatura');
    }
    if (transaction.isInvoiceDerived) {
      return left(derivedTransactionError(transaction)!);
    }
    let invoice: CardInvoice;
    if ('invoiceId' in target) {
      const found = this.invoices.get(target.invoiceId);
      if (!found) return left('Fatura não encontrada');
      invoice = found;
    } else {
      const [error, found] = this.invoiceFor(target.cardId, transaction.date);
      if (error !== null) return left(error);
      invoice = found;
    }
    const previousCardId =
      transaction.isCardPurchase && transaction.invoiceId
        ? this.invoices.get(transaction.invoiceId)?.cardId
        : undefined;
    const card = this.cards.get(invoice.cardId)!;
    transaction.invoiceRole = 'purchase';
    transaction.invoiceId = invoice.id;
    transaction.boxId = card.boxId;
    transaction.purchaseDate = null;
    transaction.sourceTransactionId = null;
    transaction.paymentId = null;
    this.transactionsTracker.registerDirty(transaction);
    this.recomputeCard(card.id);
    if (previousCardId && previousCardId !== card.id) {
      this.recomputeCard(previousCardId);
    }
    return right(transaction);
  }

  /** Desfaz: a compra volta a ser uma transação comum, contando na data dela. */
  unlinkPurchase(transactionId: string): Either<string, Transaction> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction?.isCardPurchase) {
      return left('A transação não é uma compra de cartão');
    }
    const cardId = this.invoices.get(transaction.invoiceId!)?.cardId;
    transaction.invoiceRole = null;
    transaction.invoiceId = null;
    this.transactionsTracker.registerDirty(transaction);
    if (cardId) this.recomputeCard(cardId);
    return right(transaction);
  }

  private recomputeInvoiceCard(transaction: Transaction): void {
    const cardId = transaction.invoiceId
      ? this.invoices.get(transaction.invoiceId)?.cardId
      : undefined;
    if (cardId) this.recomputeCard(cardId);
  }

  /** Distribuição dos pagamentos do cartão pelas compras (ver `allocateCard`). */
  cardAllocation(cardId: string): CardAllocation {
    const closing = new Map(
      this.invoicesOfCard(cardId).map((i) => [i.id, i.closingDate]),
    );
    return allocateCard({
      purchases: this.purchasesOfCard(cardId).map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        date: tx.date,
        createdAt: tx.createdAt,
        invoiceClosingDate: closing.get(tx.invoiceId!)!,
      })),
      payments: this.paymentsOfCard(cardId),
    });
  }

  /**
   * Mantém partes e não discriminado iguais ao que `allocateCard` manda. Cada
   * linha derivada é identificada por (pagamento, compra) ou (pagamento,
   * resto), então os ids ficam estáveis entre recálculos; só muda o que mudou.
   */
  recomputeCard(cardId: string): void {
    const card = this.cards.get(cardId);
    if (!card) return;
    const invoiceIds = new Set(this.invoicesOfCard(cardId).map((i) => i.id));
    const purchases = new Map(
      this.purchasesOfCard(cardId).map((tx) => [tx.id, tx]),
    );
    const allocation = this.cardAllocation(cardId);

    type Spec = {
      role: 'part' | 'remainder';
      amount: number;
      date: Date;
      boxId: string;
      categoryId: string | null;
      allocationId: string | null;
      withdrawalType: 'withdrawal' | 'realization' | null;
      description: string;
      purchaseDate: Date | null;
      sourceTransactionId: string | null;
      paymentId: string;
      invoiceId: string;
    };
    const desired = new Map<string, Spec>();
    for (const part of allocation.parts) {
      const payment = this.payments.get(part.paymentId)!;
      const purchase = purchases.get(part.purchaseId)!;
      desired.set(`${part.paymentId}|${part.purchaseId}`, {
        role: 'part',
        amount: part.cents / 100,
        date: payment.date,
        boxId: payment.boxId,
        categoryId: purchase.categoryId,
        allocationId: purchase.allocationId,
        withdrawalType: purchase.withdrawalType,
        description: purchase.description ?? '',
        purchaseDate: purchase.date,
        sourceTransactionId: purchase.id,
        paymentId: payment.id,
        invoiceId: purchase.invoiceId!,
      });
    }
    for (const remainder of allocation.remainders) {
      const payment = this.payments.get(remainder.paymentId)!;
      desired.set(`${remainder.paymentId}|remainder`, {
        role: 'remainder',
        amount: remainder.cents / 100,
        date: payment.date,
        boxId: payment.boxId,
        categoryId: null,
        allocationId: null,
        withdrawalType: null,
        description: invoiceRemainderDescription(card.name),
        purchaseDate: null,
        sourceTransactionId: null,
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
      });
    }

    for (const tx of [...this.transactions.values()]) {
      if (!tx.isInvoiceDerived) continue;
      const payment = tx.paymentId ? this.payments.get(tx.paymentId) : null;
      // Linhas de pagamentos de outros cartões ficam com o recálculo deles;
      // as de um pagamento que não existe mais são removidas aqui.
      if (payment && !invoiceIds.has(payment.invoiceId)) continue;
      const key = `${tx.paymentId}|${tx.isInvoiceRemainder ? 'remainder' : tx.sourceTransactionId}`;
      const spec = desired.get(key);
      if (!spec) {
        this.transactions.delete(tx.id);
        this.transactionsTracker.registerDeleted(tx);
        continue;
      }
      desired.delete(key);
      if (applySpec(tx, spec)) this.transactionsTracker.registerDirty(tx);
    }

    for (const spec of desired.values()) {
      const created = Transaction.create({
        vaultId: this.id,
        amount: spec.amount,
        type: 'expense',
        date: spec.date,
        boxId: spec.boxId,
        description: spec.description,
        categoryId: spec.categoryId,
        allocationId: spec.allocationId ?? undefined,
        withdrawalType: spec.withdrawalType,
        invoiceId: spec.invoiceId,
        invoiceRole: spec.role,
        purchaseDate: spec.purchaseDate,
        sourceTransactionId: spec.sourceTransactionId,
        paymentId: spec.paymentId,
      });
      this.addTransaction(created);
      this.commitTransaction(created.id);
    }
  }

  /** Recalcula todos os cartões. Usado depois de reprocessar o histórico. */
  recomputeAllCards(): void {
    for (const cardId of this.cards.keys()) this.recomputeCard(cardId);
  }

  /** Quanto das compras do cartão ainda não foi pago por nenhum pagamento. */
  getCardPayable(cardId: string): number {
    let cents = 0;
    for (const value of this.cardAllocation(cardId).uncovered.values()) {
      cents += value;
    }
    return cents / 100;
  }

  /**
   * Números das faturas de um cartão: os de `computeInvoiceFigures` mais o que
   * ainda está "a pagar" das compras de cada uma e o não discriminado dos
   * pagamentos dela.
   */
  getInvoiceFigures(
    cardId: string,
    today: Date = startOfUtcDay(new Date()),
  ): Map<
    string,
    InvoiceFigures & { unpaidPurchases: number; notItemized: number }
  > {
    const invoices = this.invoicesOfCard(cardId);
    const base = computeInvoiceFigures(
      invoices.map((i) => ({
        id: i.id,
        closingDate: i.closingDate,
        dueDate: i.dueDate,
        isOpen: i.isOpen(today),
        purchasesCents: this.purchasesCents(i.id),
        paidCents: this.paidCents(i.id),
      })),
      today,
    );
    const allocation = this.cardAllocation(cardId);
    const unpaid = new Map<string, number>();
    for (const [purchaseId, cents] of allocation.uncovered) {
      const invoiceId = this.transactions.get(purchaseId)!.invoiceId!;
      unpaid.set(invoiceId, (unpaid.get(invoiceId) ?? 0) + cents);
    }
    const notItemized = new Map<string, number>();
    for (const r of allocation.remainders) {
      const invoiceId = this.payments.get(r.paymentId)!.invoiceId;
      notItemized.set(invoiceId, (notItemized.get(invoiceId) ?? 0) + r.cents);
    }
    const result = new Map<
      string,
      InvoiceFigures & { unpaidPurchases: number; notItemized: number }
    >();
    for (const invoice of invoices) {
      result.set(invoice.id, {
        ...base.get(invoice.id)!,
        unpaidPurchases: (unpaid.get(invoice.id) ?? 0) / 100,
        notItemized: (notItemized.get(invoice.id) ?? 0) / 100,
      });
    }
    return result;
  }

  /**
   * Saldo disponível: o saldo de cada estrato menos o que as compras dos
   * cartões pagos por ele ainda devem ("a pagar"). O total vale para os
   * estratos de gasto, como `getBalance`.
   */
  getAvailableBalances(): {
    estratos: {
      boxId: string;
      balance: number;
      cardPayable: number;
      available: number;
    }[];
    total: { balance: number; cardPayable: number; available: number };
  } {
    const payableByBox = new Map<string, number>();
    for (const card of this.cards.values()) {
      const cents = toCents(this.getCardPayable(card.id));
      payableByBox.set(card.boxId, (payableByBox.get(card.boxId) ?? 0) + cents);
    }
    const estratos = [...this.boxes.values()].map((box) => {
      const balance = this.getBoxBalance(box.id);
      const cardPayable = (payableByBox.get(box.id) ?? 0) / 100;
      return {
        boxId: box.id,
        balance,
        cardPayable,
        available: (toCents(balance) - toCents(cardPayable)) / 100,
      };
    });
    const spending = estratos.filter(
      (e) => this.boxes.get(e.boxId)?.type !== 'saving',
    );
    const balance = this.getBalance();
    const cardPayable =
      spending.reduce((sum, e) => sum + toCents(e.cardPayable), 0) / 100;
    return {
      estratos,
      total: {
        balance,
        cardPayable,
        available: (toCents(balance) - toCents(cardPayable)) / 100,
      },
    };
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
      if (!transaction.isCommitted || !transaction.countsInLedger) continue;
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
    if ([...this.cards.values()].some((c) => c.boxId === boxId)) {
      return left('Não é possível deletar o estrato pagador de um cartão');
    }
    if ([...this.payments.values()].some((p) => p.boxId === boxId)) {
      return left('Não é possível deletar um estrato com pagamentos de fatura');
    }
    this.boxes.delete(boxId);
    this.boxesTracker.registerDeleted(box);
    return right(true);
  }

  getBoxBalance(boxId: string): number {
    let total = 0;
    for (const tx of this.transactions.values()) {
      if (tx.boxId !== boxId || !tx.isCommitted || !tx.countsInLedger) continue;
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
            !transaction.countsInLedger ||
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
      if (!transaction.countsInLedger) continue;
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
      if (!transaction.countsInLedger) continue;

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
      if (!transaction.countsInLedger) continue;
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
    this.cardsTracker.clearChanges();
    this.invoicesTracker.clearChanges();
    this.paymentsTracker.clearChanges();
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
