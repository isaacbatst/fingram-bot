import { Injectable } from '@nestjs/common';
import { Either, left, right } from './domain/either';
import { Card, cardDaysFromStatement, startOfUtcDay } from './domain/card';
import {
  CardInvoice,
  CardPayment,
  InvoiceFigures,
  toCents,
} from './domain/card-invoice';
import { ImportBatch } from './domain/import-batch';
import {
  ImportEntry,
  isCarriedBalanceDescription,
  isSettlementDescription,
  normalizeDescription,
} from './domain/import-entry';
import { Transaction } from './domain/transaction';
import { Vault } from './domain/vault';
import { VaultRepository } from './repositories/vault.repository';
import { ImportBatchRepository } from './repositories/import-batch.repository';
import { ImportEntryRepository } from './repositories/import-entry.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Distância máxima, em dias, entre as datas de um par suspeito de duplicata. */
const DUPLICATE_WINDOW_DAYS = 3;
/** Janela depois do fechamento em que um débito ainda paga aquela fatura. */
const PAYMENT_WINDOW_DAYS = 45;

export type CardView = {
  id: string;
  name: string;
  closingDay: number;
  dueDay: number;
  /** Estrato pagador. */
  boxId: string;
  accountKey: string | null;
  createdAt: Date;
  /** Compras ainda não pagas por nenhum pagamento, em todas as faturas. */
  payable: number;
  /** Fatura em aberto que contém hoje, se já existir. */
  currentInvoiceId: string | null;
};

export type StatementRef = {
  batchId: string;
  accountLabel: string | null;
  fileName: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  ledgerBalance: number | null;
};

export type InvoiceView = {
  id: string;
  cardId: string;
  cardName: string;
  periodStart: Date;
  closingDate: Date;
  dueDate: Date;
  /** Fechada à mão (closeInvoice), independente da data. */
  closedManually: boolean;
  purchaseCount: number;
  paymentCount: number;
  /** Compras ainda não pagas desta fatura ("a pagar"). */
  unpaidPurchases: number;
  /** Soma do não discriminado dos pagamentos desta fatura. */
  notItemized: number;
  statements: StatementRef[];
} & InvoiceFigures;

export type PurchaseView = {
  id: string;
  date: Date;
  description: string;
  amount: number;
  /** `income` é estorno. */
  type: 'income' | 'expense';
  categoryId: string | null;
  allocationId: string | null;
  /** Quanto já foi pago (soma das partes). Estorno: 0. */
  paid: number;
  /** Quanto falta pagar. Estorno: 0. */
  unpaid: number;
  /** Veio de um extrato de cartão importado. */
  fromStatement: boolean;
  parts: {
    transactionId: string;
    paymentId: string;
    amount: number;
    date: Date;
  }[];
};

export type PaymentView = {
  id: string;
  invoiceId: string;
  date: Date;
  amount: number;
  boxId: string;
  imported: boolean;
  importEntryId: string | null;
  notItemized: number;
  notItemizedTransactionId: string | null;
  /** Compras (possivelmente de faturas anteriores) que este pagamento pagou. */
  parts: {
    transactionId: string;
    purchaseId: string;
    purchaseInvoiceId: string;
    amount: number;
  }[];
};

export type InvoiceDetail = {
  invoice: InvoiceView;
  purchases: PurchaseView[];
  payments: PaymentView[];
};

/** Extrato de cartão com compras confirmadas que não pertencem a nenhuma fatura. */
export type PendingStatementView = {
  batchId: string;
  accountLabel: string | null;
  accountKey: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  purchaseCount: number;
  total: number;
  /** Cartão que o extrato encontraria pela conta do OFX, se já existir. */
  cardId: string | null;
};

export type DuplicateTransactionRef = {
  transactionId: string;
  date: Date;
  amount: number;
  description: string;
  categoryId: string | null;
  invoiceId: string | null;
};

export type DuplicatePair = {
  /** Lançada à mão (nenhuma linha de extrato a criou). */
  manual: DuplicateTransactionRef;
  /** Compra importada de um extrato de cartão. */
  imported: DuplicateTransactionRef & { entryId: string };
  /** `high`: descrição parecida; `medium`: só valor e data próxima. */
  confidence: 'high' | 'medium';
  dayDistance: number;
};

export type ReconcileView = {
  invoiceId: string;
  purchasesTotal: number;
  total: number;
  paid: number;
  statements: (StatementRef & {
    /** Soma líquida das linhas de compra do arquivo (sem pagamentos/saldo). */
    statementTotal: number;
    /** |LEDGERBAL| bate com o total da fatura (null sem LEDGERBAL). */
    ledgerMatchesTotal: boolean | null;
  })[];
  /** Linhas do extrato que não são compras desta fatura. */
  missing: {
    entryId: string;
    batchId: string;
    date: Date;
    amount: number;
    type: 'income' | 'expense';
    description: string;
    /** pending: não triada; dismissed: ignorada; deleted: a transação foi excluída; elsewhere: está fora desta fatura. */
    reason: 'pending' | 'dismissed' | 'deleted' | 'elsewhere';
    transactionId: string | null;
  }[];
  /** Compras desta fatura que não vieram de nenhum extrato (lançadas à mão). */
  extra: DuplicateTransactionRef[];
  duplicates: DuplicatePair[];
};

export type AvailableBalanceView = {
  estratos: {
    boxId: string;
    name: string;
    type: 'spending' | 'saving';
    balance: number;
    cardPayable: number;
    available: number;
  }[];
  cards: { cardId: string; name: string; boxId: string; payable: number }[];
  total: { balance: number; cardPayable: number; available: number };
};

export type ReprocessReport = {
  statements: {
    batchId: string;
    accountLabel: string | null;
    cardId: string;
    cardName: string;
    newCard: boolean;
    invoiceId: string;
    closingDate: Date;
    purchaseCount: number;
    total: number;
  }[];
  payments: {
    entryId: string;
    date: Date;
    amount: number;
    boxId: string;
    cardId: string;
    cardName: string;
    invoiceId: string;
    /** dismissed: linha ignorada na triagem; expense: linha confirmada como gasto comum (a despesa é removida). */
    source: 'dismissed' | 'expense';
    removedTransactionId: string | null;
  }[];
  skipped: { entryId?: string; batchId?: string; reason: string }[];
  /** Meses de orçamento cujo total de gastos muda. */
  months: { year: number; month: number; before: number; after: number }[];
};

/**
 * Linhas do extrato do cartão que são compras (ou estornos) da fatura. O
 * "Pagamento recebido" é a quitação, e o saldo da fatura anterior não é compra.
 */
export function isInvoiceLine(entry: ImportEntry): boolean {
  const text = entry.rawMemo ?? entry.rawName ?? '';
  return (
    !isSettlementDescription(text, 'creditcard') &&
    !isCarriedBalanceDescription(text)
  );
}

/** Débito de pagamento de fatura numa conta corrente. */
export function isPaymentLine(entry: ImportEntry, batch: ImportBatch): boolean {
  return (
    batch.kind === 'bank' &&
    entry.rawType === 'expense' &&
    isSettlementDescription(entry.rawMemo ?? entry.rawName ?? '', 'bank')
  );
}

const WORD_MIN = 3;
function descriptionWords(value: string): Set<string> {
  const plain = normalizeDescription(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ');
  return new Set(plain.split(/\s+/).filter((w) => w.length >= WORD_MIN));
}

/** Descrições parecidas: uma palavra de 3+ letras em comum. */
export function similarDescriptions(a: string, b: string): boolean {
  const wa = descriptionWords(a);
  for (const w of descriptionWords(b)) if (wa.has(w)) return true;
  return false;
}

/**
 * Cartões, faturas (ciclos) e pagamentos, e a ligação deles com o import.
 * As regras de contagem ficam no agregado `Vault`; aqui ficam as consultas que
 * cruzam com os extratos importados e as views da API/MCP.
 */
@Injectable()
export class CardInvoiceService {
  constructor(
    private readonly vaultRepository: VaultRepository,
    private readonly importBatchRepository: ImportBatchRepository,
    private readonly importEntryRepository: ImportEntryRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  toCardView(vault: Vault, card: Card, today = startOfUtcDay(new Date())): CardView {
    const current = vault
      .invoicesOfCard(card.id)
      .find((i) => i.contains(today) && i.isOpen(today));
    return {
      id: card.id,
      name: card.name,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
      boxId: card.boxId,
      accountKey: card.accountKey,
      createdAt: card.createdAt,
      payable: vault.getCardPayable(card.id),
      currentInvoiceId: current?.id ?? null,
    };
  }

  private statementRef(batch: ImportBatch): StatementRef {
    return {
      batchId: batch.id,
      accountLabel: batch.accountLabel,
      fileName: batch.fileName,
      periodStart: batch.periodStart,
      periodEnd: batch.periodEnd,
      ledgerBalance: batch.ledgerBalance,
    };
  }

  private invoiceViews(
    vault: Vault,
    cardId: string,
    batches: ImportBatch[],
    today = startOfUtcDay(new Date()),
  ): InvoiceView[] {
    const card = vault.cards.get(cardId)!;
    const figures = vault.getInvoiceFigures(cardId, today);
    const transactions = [...vault.transactions.values()];
    const payments = vault.paymentsOfCard(cardId);
    return vault.invoicesOfCard(cardId).map((invoice) => {
      const f = figures.get(invoice.id)!;
      return {
        id: invoice.id,
        cardId,
        cardName: card.name,
        periodStart: invoice.periodStart,
        closingDate: invoice.closingDate,
        dueDate: invoice.dueDate,
        closedManually: invoice.closed,
        ...f,
        purchaseCount: transactions.filter(
          (t) => t.isCardPurchase && t.invoiceId === invoice.id,
        ).length,
        paymentCount: payments.filter((p) => p.invoiceId === invoice.id).length,
        statements: batches
          .filter((b) => b.invoiceId === invoice.id)
          .map((b) => this.statementRef(b)),
      };
    });
  }

  private invoiceView(
    vault: Vault,
    invoiceId: string,
    batches: ImportBatch[],
  ): InvoiceView | null {
    const invoice = vault.invoices.get(invoiceId);
    if (!invoice) return null;
    return (
      this.invoiceViews(vault, invoice.cardId, batches).find(
        (i) => i.id === invoiceId,
      ) ?? null
    );
  }

  private async loadVault(vaultId: string): Promise<Either<string, Vault>> {
    const vault = await this.vaultRepository.findById(vaultId);
    return vault ? right(vault) : left('Dados não encontrados');
  }

  // ---------------------------------------------------------------------------
  // Cartões
  // ---------------------------------------------------------------------------

  async listCards(vaultId: string): Promise<Either<string, CardView[]>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    return right(
      [...vault.cards.values()]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((card) => this.toCardView(vault, card)),
    );
  }

  async createCard(
    vaultId: string,
    input: {
      name: string;
      closingDay: number;
      dueDay: number;
      boxId?: string;
      accountKey?: string | null;
    },
  ): Promise<Either<string, CardView>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const [cardError, card] = vault.addCard(input);
    if (cardError !== null) return left(cardError);
    await this.vaultRepository.update(vault);
    return right(this.toCardView(vault, card));
  }

  async updateCard(
    vaultId: string,
    cardId: string,
    changes: {
      name?: string;
      closingDay?: number;
      dueDay?: number;
      boxId?: string;
      accountKey?: string | null;
    },
  ): Promise<Either<string, CardView>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const [cardError, card] = vault.updateCard(cardId, changes);
    if (cardError !== null) return left(cardError);
    await this.vaultRepository.update(vault);
    return right(this.toCardView(vault, card));
  }

  async deleteCard(vaultId: string, cardId: string): Promise<Either<string, true>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const invoiceIds = new Set(vault.invoicesOfCard(cardId).map((i) => i.id));
    const [cardError] = vault.deleteCard(cardId);
    if (cardError !== null) return left(cardError);
    // Extratos que apontavam para as faturas vazias do cartão ficam sem fatura.
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    for (const batch of batches) {
      if (batch.invoiceId && invoiceIds.has(batch.invoiceId)) {
        batch.invoiceId = null;
        await this.importBatchRepository.update(batch);
      }
    }
    await this.vaultRepository.update(vault);
    return right(true);
  }

  /**
   * O cartão de um extrato de cartão: o da conta do OFX; senão o único cartão
   * ainda sem conta (criado à mão ou pela triagem de um pagamento), que passa a
   * tê-la; senão um cartão novo com os dias sugeridos pelo período do arquivo.
   */
  cardForStatement(
    vault: Vault,
    batch: ImportBatch,
    lastDate: Date | null,
  ): Either<string, { card: Card; created: boolean }> {
    const byKey = vault.findCardByAccountKey(batch.accountKey);
    if (byKey) return right({ card: byKey, created: false });
    const keyless = [...vault.cards.values()].filter((c) => !c.accountKey);
    if (keyless.length === 1 && vault.cards.size === 1) {
      vault.updateCard(keyless[0].id, { accountKey: batch.accountKey });
      return right({ card: keyless[0], created: false });
    }
    const reference = batch.periodEnd ?? lastDate ?? new Date();
    const days = cardDaysFromStatement(startOfUtcDay(reference));
    const [error, card] = vault.addCard({
      name: batch.accountLabel ?? 'Cartão',
      closingDay: days.closingDay,
      dueDay: days.dueDay,
      boxId: batch.boxId ?? undefined,
      accountKey: batch.accountKey,
    });
    if (error !== null) return left(error);
    return right({ card, created: true });
  }

  /**
   * Liga um extrato de cartão ao seu cartão e à fatura do período dele. Altera
   * `vault` e `batch` sem salvar.
   */
  attachStatement(
    vault: Vault,
    batch: ImportBatch,
    entries: ImportEntry[],
  ): Either<string, { card: Card; invoice: CardInvoice; newCard: boolean }> {
    const times = entries.map((e) => e.rawDate.getTime());
    const lastDate = times.length ? new Date(Math.max(...times)) : null;
    const [error, found] = this.cardForStatement(vault, batch, lastDate);
    if (error !== null) return left(error);
    const [invoiceError, invoice] = vault.statementInvoice(
      found.card.id,
      { periodStart: batch.periodStart, periodEnd: batch.periodEnd },
      lastDate ?? new Date(),
    );
    if (invoiceError !== null) return left(invoiceError);
    batch.invoiceId = invoice.id;
    return right({ card: found.card, invoice, newCard: found.created });
  }

  /**
   * Para onde vai um débito de pagamento de fatura: o cartão pago pelo estrato
   * da conta (o único, ou o que tem uma fatura cujo total bate com o valor) e a
   * fatura sugerida pela data. `invoiceId` é null quando a fatura sugerida
   * ainda não existe — ela é criada ao confirmar.
   */
  suggestPaymentTarget(
    vault: Vault,
    line: { amount: number; date: Date; boxId: string | null },
  ): {
    cardId: string;
    cardName: string;
    invoiceId: string | null;
    closingDate: Date;
    dueDate: Date;
  } | null {
    const card = this.pickCardForPayment(vault, line);
    if (!card) return null;
    const [error, invoice] = vault.suggestInvoiceForPayment(
      card.id,
      line.date,
      { dryRun: true },
    );
    if (error !== null) return null;
    const persisted = vault.invoices.has(invoice.id);
    return {
      cardId: card.id,
      cardName: card.name,
      invoiceId: persisted ? invoice.id : null,
      closingDate: invoice.closingDate,
      dueDate: invoice.dueDate,
    };
  }

  private pickCardForPayment(
    vault: Vault,
    line: { amount: number; date: Date; boxId: string | null },
  ): Card | null {
    const all = [...vault.cards.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    if (all.length === 0) return null;
    const sameBox = all.filter((c) => c.boxId === line.boxId);
    const pool = sameBox.length > 0 ? sameBox : all;
    if (pool.length === 1) return pool[0];
    const cents = toCents(line.amount);
    const byAmount = pool.find((card) => {
      const figures = vault.getInvoiceFigures(card.id, startOfUtcDay(line.date));
      return vault.invoicesOfCard(card.id).some((i) => {
        const inWindow =
          i.closingDate.getTime() < line.date.getTime() &&
          line.date.getTime() <=
            i.closingDate.getTime() + PAYMENT_WINDOW_DAYS * DAY_MS;
        return inWindow && toCents(figures.get(i.id)!.total) === cents;
      });
    });
    return byAmount ?? pool[0];
  }

  // ---------------------------------------------------------------------------
  // Faturas
  // ---------------------------------------------------------------------------

  async listInvoices(
    vaultId: string,
    filter: { cardId?: string } = {},
  ): Promise<
    Either<
      string,
      { invoices: InvoiceView[]; pendingStatements: PendingStatementView[] }
    >
  > {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    if (filter.cardId && !vault.cards.get(filter.cardId)) {
      return left('Cartão não encontrado');
    }
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    const cardIds = filter.cardId ? [filter.cardId] : [...vault.cards.keys()];
    const invoices = cardIds
      .flatMap((cardId) => this.invoiceViews(vault, cardId, batches))
      .sort((a, b) => b.closingDate.getTime() - a.closingDate.getTime());
    const pendingStatements = await this.pendingStatements(vault, batches);
    return right({ invoices, pendingStatements });
  }

  /**
   * Extratos de cartão sem fatura (importados antes dos cartões) com compras
   * confirmadas que ainda contam na data da compra. Um extrato marcado "sem
   * fatura" sai da lista.
   */
  private async pendingStatements(
    vault: Vault,
    batches: ImportBatch[],
  ): Promise<PendingStatementView[]> {
    const result: PendingStatementView[] = [];
    for (const batch of batches) {
      if (batch.kind !== 'creditcard' || batch.invoiceId || batch.noInvoice) {
        continue;
      }
      const entries = await this.importEntryRepository.findAllByBatchId(
        batch.id,
      );
      let purchaseCount = 0;
      let totalCents = 0;
      for (const entry of entries) {
        const tx = this.statementPurchaseCandidate(vault, entry);
        if (!tx) continue;
        purchaseCount++;
        totalCents +=
          tx.type === 'expense' ? toCents(tx.amount) : -toCents(tx.amount);
      }
      if (purchaseCount === 0) continue;
      result.push({
        batchId: batch.id,
        accountLabel: batch.accountLabel,
        accountKey: batch.accountKey,
        periodStart: batch.periodStart,
        periodEnd: batch.periodEnd,
        purchaseCount,
        total: totalCents / 100,
        cardId: vault.findCardByAccountKey(batch.accountKey)?.id ?? null,
      });
    }
    return result;
  }

  /** A transação de uma linha confirmada que pode virar compra de cartão. */
  private statementPurchaseCandidate(
    vault: Vault,
    entry: ImportEntry,
  ): Transaction | null {
    if (entry.status !== 'confirmed' || !entry.transactionId) return null;
    if (!isInvoiceLine(entry)) return null;
    const tx = vault.transactions.get(entry.transactionId);
    if (!tx || tx.transferId || tx.invoiceRole) return null;
    return tx;
  }

  async getInvoice(
    vaultId: string,
    invoiceId: string,
  ): Promise<Either<string, InvoiceDetail>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const invoice = vault.invoices.get(invoiceId);
    if (!invoice) return left('Fatura não encontrada');
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    const view = this.invoiceView(vault, invoiceId, batches)!;

    const statementTxIds = new Set<string>();
    for (const batch of batches.filter((b) => b.invoiceId === invoiceId)) {
      for (const entry of await this.importEntryRepository.findAllByBatchId(
        batch.id,
      )) {
        if (entry.transactionId) statementTxIds.add(entry.transactionId);
      }
    }

    const allocation = vault.cardAllocation(invoice.cardId);
    const transactions = [...vault.transactions.values()];
    const derived = transactions.filter((t) => t.isInvoiceDerived);
    const purchases: PurchaseView[] = transactions
      .filter((t) => t.isCardPurchase && t.invoiceId === invoiceId)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((tx) => {
        const parts = derived
          .filter((d) => d.isInvoicePart && d.sourceTransactionId === tx.id)
          .map((d) => ({
            transactionId: d.id,
            paymentId: d.paymentId!,
            amount: d.amount,
            date: d.date,
          }))
          .sort((a, b) => a.date.getTime() - b.date.getTime());
        const unpaidCents =
          tx.type === 'expense' ? (allocation.uncovered.get(tx.id) ?? 0) : 0;
        return {
          id: tx.id,
          date: tx.date,
          description: tx.description ?? '',
          amount: tx.amount,
          type: tx.type,
          categoryId: tx.categoryId,
          allocationId: tx.allocationId,
          paid:
            tx.type === 'expense'
              ? (toCents(tx.amount) - unpaidCents) / 100
              : 0,
          unpaid: unpaidCents / 100,
          fromStatement: statementTxIds.has(tx.id),
          parts,
        };
      });

    const payments: PaymentView[] = [...vault.payments.values()]
      .filter((p) => p.invoiceId === invoiceId)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((payment) => this.paymentView(vault, payment));

    return right({ invoice: view, purchases, payments });
  }

  private paymentView(vault: Vault, payment: CardPayment): PaymentView {
    const rows = [...vault.transactions.values()].filter(
      (t) => t.isInvoiceDerived && t.paymentId === payment.id,
    );
    const remainder = rows.find((t) => t.isInvoiceRemainder);
    return {
      id: payment.id,
      invoiceId: payment.invoiceId,
      date: payment.date,
      amount: payment.amount,
      boxId: payment.boxId,
      imported: payment.imported,
      importEntryId: payment.importEntryId,
      notItemized: remainder?.amount ?? 0,
      notItemizedTransactionId: remainder?.id ?? null,
      parts: rows
        .filter((t) => t.isInvoicePart)
        .map((t) => ({
          transactionId: t.id,
          purchaseId: t.sourceTransactionId!,
          purchaseInvoiceId: t.invoiceId!,
          amount: t.amount,
        })),
    };
  }

  async updateInvoice(
    vaultId: string,
    invoiceId: string,
    changes: {
      periodStart?: Date;
      closingDate?: Date;
      dueDate?: Date;
      closed?: boolean;
    },
  ): Promise<Either<string, InvoiceView>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const [updateError] = vault.updateInvoice(invoiceId, changes);
    if (updateError !== null) return left(updateError);
    await this.vaultRepository.update(vault);
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    return right(this.invoiceView(vault, invoiceId, batches)!);
  }

  async closeInvoice(
    vaultId: string,
    invoiceId: string,
    closingDate?: Date,
  ): Promise<Either<string, InvoiceView>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const [closeError] = vault.closeInvoice(invoiceId, closingDate);
    if (closeError !== null) return left(closeError);
    await this.vaultRepository.update(vault);
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    return right(this.invoiceView(vault, invoiceId, batches)!);
  }

  // ---------------------------------------------------------------------------
  // Pagamentos
  // ---------------------------------------------------------------------------

  /**
   * Registra um pagamento de fatura: novo (valor e data) ou a partir de uma
   * transação já lançada como gasto comum (`transactionId`), que é removida —
   * o pagamento não é gasto, e manter a despesa contaria duas vezes.
   * Sem `invoiceId`, a fatura é sugerida pela data dentro do cartão.
   * Recusa um pagamento igual (mesmo cartão, valor e data a até 7 dias) a menos
   * que `allowDuplicate`.
   */
  async addPayment(
    vaultId: string,
    input: {
      invoiceId?: string;
      cardId?: string;
      amount?: number;
      date?: Date;
      boxId?: string;
      transactionId?: string;
      allowDuplicate?: boolean;
    },
  ): Promise<Either<string, { payment: PaymentView; invoice: InvoiceView }>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);

    let amount = input.amount;
    let date = input.date;
    let boxId = input.boxId;
    let entry: ImportEntry | null = null;
    let source: Transaction | null = null;
    if (input.transactionId) {
      source = vault.transactions.get(input.transactionId) ?? null;
      if (!source) return left('Transação não encontrada');
      if (
        source.type !== 'expense' ||
        source.transferId ||
        source.invoiceRole ||
        source.allocationId
      ) {
        return left(
          'Só uma despesa comum (sem transferência, plano ou fatura) pode virar pagamento de fatura',
        );
      }
      amount = source.amount;
      date = source.date;
      boxId = boxId ?? (source.boxId || undefined);
      entry = await this.importEntryRepository.findByTransactionId(source.id);
    }
    if (amount === undefined || date === undefined) {
      return left('Informe valor e data, ou a transação que é o pagamento');
    }

    const cardId =
      input.cardId ??
      (input.invoiceId ? vault.invoices.get(input.invoiceId)?.cardId : undefined);
    if (!cardId || !vault.cards.get(cardId)) {
      return left(input.invoiceId ? 'Fatura não encontrada' : 'Cartão não encontrado');
    }
    if (!input.allowDuplicate) {
      const cents = toCents(amount);
      const duplicate = vault
        .paymentsOfCard(cardId)
        .find(
          (p) =>
            toCents(p.amount) === cents &&
            Math.abs(p.date.getTime() - date.getTime()) <= 7 * DAY_MS,
        );
      if (duplicate) {
        return left(
          `Já existe um pagamento de mesmo valor em ${duplicate.date.toISOString().slice(0, 10)} (id ${duplicate.id}). Se for mesmo outro pagamento, envie allowDuplicate: true.`,
        );
      }
    }

    const [paymentError, payment] = vault.addPayment({
      invoiceId: input.invoiceId,
      cardId,
      amount,
      date,
      boxId,
      imported: entry !== null,
      importEntryId: entry?.id ?? null,
    });
    if (paymentError !== null) return left(paymentError);
    if (source) vault.deleteTransaction(source.id);

    await this.vaultRepository.update(vault);
    if (entry) {
      entry.detachTransaction();
      await this.importEntryRepository.update(entry);
    }
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    return right({
      payment: this.paymentView(vault, payment),
      invoice: this.invoiceView(vault, payment.invoiceId, batches)!,
    });
  }

  async updatePayment(
    vaultId: string,
    paymentId: string,
    changes: { amount?: number; date?: Date; invoiceId?: string; boxId?: string },
  ): Promise<Either<string, { payment: PaymentView; invoice: InvoiceView }>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const [updateError, payment] = vault.updatePayment(paymentId, changes);
    if (updateError !== null) return left(updateError);
    await this.vaultRepository.update(vault);
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    return right({
      payment: this.paymentView(vault, payment),
      invoice: this.invoiceView(vault, payment.invoiceId, batches)!,
    });
  }

  async deletePayment(
    vaultId: string,
    paymentId: string,
  ): Promise<Either<string, true>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const [deleteError] = vault.deletePayment(paymentId);
    if (deleteError !== null) return left(deleteError);
    await this.vaultRepository.update(vault);
    return right(true);
  }

  // ---------------------------------------------------------------------------
  // Compras
  // ---------------------------------------------------------------------------

  /**
   * Liga transações a uma fatura (ou ao cartão, pela data de cada uma), ou
   * desliga com `target: null`. Cada id é tratado à parte; falhas voltam em
   * `failed` sem impedir as demais.
   */
  async linkTransactions(
    vaultId: string,
    transactionIds: string[],
    target: { invoiceId: string } | { cardId: string } | null,
  ): Promise<
    Either<
      string,
      {
        updated: string[];
        failed: { id: string; error: string }[];
        invoice: InvoiceView | null;
      }
    >
  > {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    if (target && 'invoiceId' in target && !vault.invoices.get(target.invoiceId)) {
      return left('Fatura não encontrada');
    }
    if (target && 'cardId' in target && !vault.cards.get(target.cardId)) {
      return left('Cartão não encontrado');
    }
    const updated: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of new Set(transactionIds)) {
      const [linkError] = target
        ? vault.linkPurchase(id, target)
        : vault.unlinkPurchase(id);
      if (linkError !== null) failed.push({ id, error: linkError });
      else updated.push(id);
    }
    if (updated.length > 0) await this.vaultRepository.update(vault);
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    const invoice =
      target && 'invoiceId' in target
        ? this.invoiceView(vault, target.invoiceId, batches)
        : null;
    return right({ updated, failed, invoice });
  }

  // ---------------------------------------------------------------------------
  // Extratos
  // ---------------------------------------------------------------------------

  /**
   * Liga um extrato de cartão a uma fatura, levando as compras já confirmadas
   * dele; `invoiceId: null` desliga e as compras voltam a contar na data delas.
   */
  async setBatchInvoice(
    vaultId: string,
    batchId: string,
    invoiceId: string | null,
  ): Promise<Either<string, ImportBatch>> {
    const batch = await this.importBatchRepository.findById(batchId);
    if (!batch || batch.vaultId !== vaultId) {
      return left('Importação não encontrada');
    }
    if (batch.kind !== 'creditcard') {
      return left('Só extratos de cartão pertencem a uma fatura');
    }
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    if (invoiceId && !vault.invoices.get(invoiceId)) {
      return left('Fatura não encontrada');
    }
    const entries = await this.importEntryRepository.findAllByBatchId(batch.id);
    const previous = batch.invoiceId;
    for (const entry of entries) {
      if (entry.status !== 'confirmed' || !entry.transactionId) continue;
      if (!isInvoiceLine(entry)) continue;
      const tx = vault.transactions.get(entry.transactionId);
      if (!tx || tx.transferId || tx.isInvoiceDerived) continue;
      if (invoiceId) vault.linkPurchase(tx.id, { invoiceId });
      else if (previous && tx.isCardPurchase && tx.invoiceId === previous) {
        vault.unlinkPurchase(tx.id);
      }
    }
    batch.invoiceId = invoiceId;
    if (invoiceId) batch.noInvoice = false;
    await this.vaultRepository.update(vault);
    await this.importBatchRepository.update(batch);
    return right(batch);
  }

  /** Marca (ou desmarca) um extrato de cartão como "sem fatura". */
  async setBatchNoInvoice(
    vaultId: string,
    batchId: string,
    noInvoice: boolean,
  ): Promise<Either<string, ImportBatch>> {
    const batch = await this.importBatchRepository.findById(batchId);
    if (!batch || batch.vaultId !== vaultId) {
      return left('Importação não encontrada');
    }
    if (batch.kind !== 'creditcard') {
      return left('Só extratos de cartão podem ser marcados sem fatura');
    }
    if (noInvoice && batch.invoiceId) {
      return left('O extrato está ligado a uma fatura: desligue antes');
    }
    batch.noInvoice = noInvoice;
    await this.importBatchRepository.update(batch);
    return right(batch);
  }

  // ---------------------------------------------------------------------------
  // Conferência
  // ---------------------------------------------------------------------------

  /**
   * Pares suspeitos de duplicata: uma transação lançada à mão (nenhuma linha
   * de extrato a criou) e uma compra importada de um extrato de cartão, com o
   * mesmo valor e datas a até 3 dias. Descrição parecida dá confiança alta.
   */
  async listDuplicates(
    vaultId: string,
    filter: { invoiceId?: string } = {},
  ): Promise<Either<string, DuplicatePair[]>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const entries = await this.importEntryRepository.findAllByVaultId(vaultId);
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    return right(this.findDuplicates(vault, entries, batches, filter.invoiceId));
  }

  private findDuplicates(
    vault: Vault,
    entries: ImportEntry[],
    batches: ImportBatch[],
    invoiceId?: string,
  ): DuplicatePair[] {
    const cardBatchIds = new Set(
      batches.filter((b) => b.kind === 'creditcard').map((b) => b.id),
    );
    const fromEntry = new Map<string, ImportEntry>();
    for (const entry of entries) {
      if (entry.transactionId) fromEntry.set(entry.transactionId, entry);
    }
    const eligible = (t: Transaction) =>
      t.type === 'expense' && !t.transferId && !t.isInvoiceDerived;
    const imported = [...vault.transactions.values()].filter((t) => {
      const entry = fromEntry.get(t.id);
      return eligible(t) && entry && cardBatchIds.has(entry.batchId);
    });
    const manual = [...vault.transactions.values()].filter(
      (t) => eligible(t) && !fromEntry.has(t.id),
    );
    const ref = (t: Transaction): DuplicateTransactionRef => ({
      transactionId: t.id,
      date: t.date,
      amount: t.amount,
      description: t.description ?? '',
      categoryId: t.categoryId,
      invoiceId: t.isCardPurchase ? t.invoiceId : null,
    });

    const pairs: DuplicatePair[] = [];
    for (const m of manual) {
      for (const i of imported) {
        if (toCents(m.amount) !== toCents(i.amount)) continue;
        const dayDistance = Math.round(
          Math.abs(m.date.getTime() - i.date.getTime()) / DAY_MS,
        );
        if (dayDistance > DUPLICATE_WINDOW_DAYS) continue;
        if (
          invoiceId &&
          (m.isCardPurchase ? m.invoiceId : null) !== invoiceId &&
          i.invoiceId !== invoiceId
        ) {
          continue;
        }
        pairs.push({
          manual: ref(m),
          imported: { ...ref(i), entryId: fromEntry.get(i.id)!.id },
          confidence: similarDescriptions(
            m.description ?? '',
            i.description ?? '',
          )
            ? 'high'
            : 'medium',
          dayDistance,
        });
      }
    }
    return pairs.sort(
      (a, b) =>
        (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1) ||
        a.dayDistance - b.dayDistance,
    );
  }

  /**
   * Confere a fatura contra os extratos ligados a ela: linhas do arquivo que
   * não viraram compras desta fatura, compras lançadas à mão que o arquivo não
   * tem, e pares suspeitos de duplicata.
   */
  async reconcileInvoice(
    vaultId: string,
    invoiceId: string,
  ): Promise<Either<string, ReconcileView>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const invoice = vault.invoices.get(invoiceId);
    if (!invoice) return left('Fatura não encontrada');
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    const view = this.invoiceView(vault, invoiceId, batches)!;
    const linked = batches.filter((b) => b.invoiceId === invoiceId);

    const fromStatement = new Set<string>();
    const missing: ReconcileView['missing'] = [];
    const statements: ReconcileView['statements'] = [];
    for (const batch of linked) {
      const entries = await this.importEntryRepository.findAllByBatchId(
        batch.id,
      );
      let netCents = 0;
      for (const entry of entries.filter((e) => isInvoiceLine(e))) {
        const cents = toCents(entry.amount);
        netCents += entry.type === 'expense' ? cents : -cents;
        const tx = entry.transactionId
          ? vault.transactions.get(entry.transactionId)
          : undefined;
        if (tx?.isCardPurchase && tx.invoiceId === invoiceId) {
          fromStatement.add(tx.id);
          continue;
        }
        let reason: ReconcileView['missing'][number]['reason'];
        if (entry.status === 'pending') reason = 'pending';
        else if (entry.status === 'dismissed') reason = 'dismissed';
        else if (!tx) reason = 'deleted';
        else reason = 'elsewhere';
        missing.push({
          entryId: entry.id,
          batchId: batch.id,
          date: entry.date,
          amount: entry.amount,
          type: entry.type,
          description: entry.description,
          reason,
          transactionId: tx?.id ?? null,
        });
      }
      statements.push({
        ...this.statementRef(batch),
        statementTotal: netCents / 100,
        ledgerMatchesTotal:
          batch.ledgerBalance === null
            ? null
            : Math.abs(toCents(batch.ledgerBalance)) === toCents(view.total),
      });
    }

    const extra = [...vault.transactions.values()]
      .filter(
        (t) =>
          t.isCardPurchase && t.invoiceId === invoiceId && !fromStatement.has(t.id),
      )
      .map((t) => ({
        transactionId: t.id,
        date: t.date,
        amount: t.amount,
        description: t.description ?? '',
        categoryId: t.categoryId,
        invoiceId: t.invoiceId,
      }));

    const entries = await this.importEntryRepository.findAllByVaultId(vaultId);
    return right({
      invoiceId,
      purchasesTotal: view.purchasesTotal,
      total: view.total,
      paid: view.paid,
      statements,
      missing,
      extra: linked.length > 0 ? extra : [],
      duplicates: this.findDuplicates(vault, entries, batches, invoiceId),
    });
  }

  async getAvailableBalance(
    vaultId: string,
  ): Promise<Either<string, AvailableBalanceView>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const balances = vault.getAvailableBalances();
    return right({
      estratos: balances.estratos.map((e) => {
        const box = vault.boxes.get(e.boxId)!;
        return { ...e, name: box.name, type: box.type };
      }),
      cards: [...vault.cards.values()].map((c) => ({
        cardId: c.id,
        name: c.name,
        boxId: c.boxId,
        payable: vault.getCardPayable(c.id),
      })),
      total: balances.total,
    });
  }

  // ---------------------------------------------------------------------------
  // Reprocessar o histórico
  // ---------------------------------------------------------------------------

  async previewReprocess(
    vaultId: string,
  ): Promise<Either<string, ReprocessReport>> {
    return this.reprocess(vaultId, false);
  }

  async applyReprocess(vaultId: string): Promise<Either<string, ReprocessReport>> {
    return this.reprocess(vaultId, true);
  }

  /**
   * Converte o histórico de antes dos cartões: extratos de cartão sem fatura
   * ganham cartão e fatura pelo período e as compras confirmadas deles viram
   * compras de cartão; débitos "pagamento de fatura" da conta corrente que
   * foram ignorados (ou lançados como gasto comum) viram pagamentos. As datas
   * de contagem são recalculadas por `Vault.recomputeCard`.
   *
   * A prévia roda a mesma conversão no agregado em memória e descarta: o que
   * ela mostra é exatamente o que `apply` grava.
   */
  private async reprocess(
    vaultId: string,
    apply: boolean,
  ): Promise<Either<string, ReprocessReport>> {
    const [error, vault] = await this.loadVault(vaultId);
    if (error !== null) return left(error);
    const batches = await this.importBatchRepository.findByVaultId(vaultId);
    const entries = await this.importEntryRepository.findAllByVaultId(vaultId);
    const entriesByBatch = new Map<string, ImportEntry[]>();
    for (const entry of entries) {
      const list = entriesByBatch.get(entry.batchId) ?? [];
      list.push(entry);
      entriesByBatch.set(entry.batchId, list);
    }
    const batchById = new Map(batches.map((b) => [b.id, b]));

    // Os meses que podem mudar: as datas atuais das compras candidatas e as
    // datas dos débitos que viram pagamento.
    const statementBatches = batches
      .filter((b) => b.kind === 'creditcard' && !b.invoiceId && !b.noInvoice)
      .sort(
        (a, b) =>
          (a.periodEnd?.getTime() ?? a.createdAt.getTime()) -
          (b.periodEnd?.getTime() ?? b.createdAt.getTime()),
      );
    const usedEntries = new Set(
      [...vault.payments.values()].map((p) => p.importEntryId).filter(Boolean),
    );
    const paymentEntries = entries
      .filter((entry) => {
        const batch = batchById.get(entry.batchId);
        if (!batch || !isPaymentLine(entry, batch)) return false;
        if (usedEntries.has(entry.id)) return false;
        if (entry.status === 'dismissed') return true;
        if (entry.status !== 'confirmed' || !entry.transactionId) return false;
        const tx = vault.transactions.get(entry.transactionId);
        return (
          !!tx &&
          tx.type === 'expense' &&
          !tx.transferId &&
          !tx.invoiceRole &&
          !tx.allocationId
        );
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const periods = new Map<string, { year: number; month: number }>();
    const addPeriod = (date: Date) => {
      const p = vault.getCurrentBudgetPeriod(date);
      periods.set(`${p.year}-${p.month}`, p);
    };
    for (const batch of statementBatches) {
      for (const entry of entriesByBatch.get(batch.id) ?? []) {
        const tx = this.statementPurchaseCandidate(vault, entry);
        if (tx) addPeriod(tx.date);
      }
    }
    for (const entry of paymentEntries) addPeriod(entry.date);
    const before = new Map(
      [...periods].map(([key, p]) => [key, vault.totalSpentAmount(p)]),
    );

    const report: ReprocessReport = {
      statements: [],
      payments: [],
      skipped: [],
      months: [],
    };
    const touchedBatches: ImportBatch[] = [];
    const touchedEntries: ImportEntry[] = [];

    for (const batch of statementBatches) {
      const batchEntries = entriesByBatch.get(batch.id) ?? [];
      const candidates = batchEntries
        .map((entry) => this.statementPurchaseCandidate(vault, entry))
        .filter((tx): tx is Transaction => tx !== null);
      if (candidates.length === 0) continue;
      const [attachError, attached] = this.attachStatement(
        vault,
        batch,
        batchEntries,
      );
      if (attachError !== null) {
        report.skipped.push({ batchId: batch.id, reason: attachError });
        continue;
      }
      let totalCents = 0;
      for (const tx of candidates) {
        vault.linkPurchase(tx.id, { invoiceId: attached.invoice.id });
        totalCents +=
          tx.type === 'expense' ? toCents(tx.amount) : -toCents(tx.amount);
      }
      touchedBatches.push(batch);
      report.statements.push({
        batchId: batch.id,
        accountLabel: batch.accountLabel,
        cardId: attached.card.id,
        cardName: attached.card.name,
        newCard: attached.newCard,
        invoiceId: attached.invoice.id,
        closingDate: attached.invoice.closingDate,
        purchaseCount: candidates.length,
        total: totalCents / 100,
      });
    }

    for (const entry of paymentEntries) {
      const batch = batchById.get(entry.batchId)!;
      const boxId = entry.boxId ?? batch.boxId;
      const card = this.pickCardForPayment(vault, {
        amount: entry.amount,
        date: entry.date,
        boxId,
      });
      if (!card) {
        report.skipped.push({
          entryId: entry.id,
          reason: 'Nenhum cartão cadastrado para receber o pagamento',
        });
        continue;
      }
      const [paymentError, payment] = vault.addPayment({
        cardId: card.id,
        amount: entry.amount,
        date: entry.date,
        boxId: boxId ?? undefined,
        imported: true,
        importEntryId: entry.id,
      });
      if (paymentError !== null) {
        report.skipped.push({ entryId: entry.id, reason: paymentError });
        continue;
      }
      let removedTransactionId: string | null = null;
      if (entry.status === 'confirmed' && entry.transactionId) {
        removedTransactionId = entry.transactionId;
        vault.deleteTransaction(entry.transactionId);
        entry.detachTransaction();
        touchedEntries.push(entry);
      }
      report.payments.push({
        entryId: entry.id,
        date: entry.date,
        amount: entry.amount,
        boxId: payment.boxId,
        cardId: card.id,
        cardName: card.name,
        invoiceId: payment.invoiceId,
        source: removedTransactionId ? 'expense' : 'dismissed',
        removedTransactionId,
      });
    }

    for (const [key, p] of periods) {
      const after = vault.totalSpentAmount(p);
      const was = before.get(key)!;
      if (toCents(after) !== toCents(was)) {
        report.months.push({ year: p.year, month: p.month, before: was, after });
      }
    }
    report.months.sort((a, b) => a.year - b.year || a.month - b.month);

    if (apply) {
      await this.vaultRepository.update(vault);
      for (const batch of touchedBatches) {
        await this.importBatchRepository.update(batch);
      }
      for (const entry of touchedEntries) {
        await this.importEntryRepository.update(entry);
      }
    }
    return right(report);
  }
}

