import { Injectable } from '@nestjs/common';
import { Either, left, right } from './domain/either';
import {
  CardInvoice,
  InvoiceBreakdown,
  statementMatchesInvoice,
} from './domain/card-invoice';
import { ImportBatch } from './domain/import-batch';
import { ImportEntry, isSettlementDescription } from './domain/import-entry';
import { Vault } from './domain/vault';
import { VaultRepository } from './repositories/vault.repository';
import { ImportBatchRepository } from './repositories/import-batch.repository';
import { ImportEntryRepository } from './repositories/import-entry.repository';

export type InvoiceView = {
  id: string;
  amount: number;
  paymentDate: Date;
  boxId: string;
  cardLabel: string | null;
  createdAt: Date;
  /** Extratos de cartão ligados a esta fatura. */
  statements: { batchId: string; accountLabel: string | null }[];
} & InvoiceBreakdown;

/** Extrato de cartão com compras confirmadas que ainda não pertencem a uma fatura. */
export type UnlinkedStatementView = {
  batchId: string;
  accountLabel: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  purchaseCount: number;
  total: number;
};

/**
 * Linhas do extrato do cartão que detalham a fatura. O "Pagamento recebido" é a
 * quitação de uma fatura, não uma compra: ligá-lo abateria o valor duas vezes.
 */
export function isInvoiceLine(entry: ImportEntry): boolean {
  return !isSettlementDescription(
    entry.rawMemo ?? entry.rawName ?? '',
    'creditcard',
  );
}

/**
 * Vínculo entre faturas de cartão e os extratos do cartão que as detalham.
 *
 * Um extrato de cartão (um arquivo OFX) detalha uma fatura. O vínculo fica no
 * lote: compras confirmadas antes ou depois dele entram na mesma fatura. As
 * mudanças de saldo e de data acontecem no agregado `Vault`, que mantém o não
 * discriminado de cada fatura.
 */
@Injectable()
export class CardInvoiceService {
  constructor(
    private readonly vaultRepository: VaultRepository,
    private readonly importBatchRepository: ImportBatchRepository,
    private readonly importEntryRepository: ImportEntryRepository,
  ) {}

  /**
   * Liga um extrato de cartão a uma fatura (ou desliga, com `null`), levando
   * junto as compras já confirmadas dele. Altera `vault` e `batch` sem salvar:
   * quem chama salva os dois.
   */
  applyBatchLink(
    vault: Vault,
    batch: ImportBatch,
    entries: ImportEntry[],
    invoiceId: string | null,
  ): Either<string, true> {
    if (batch.kind !== 'creditcard') {
      return left('Só extratos de cartão podem detalhar uma fatura');
    }
    const invoice = invoiceId ? vault.invoices.get(invoiceId) : null;
    if (invoiceId && !invoice) return left('Fatura não encontrada');

    const previous = batch.invoiceId;
    for (const entry of entries) {
      if (entry.status !== 'confirmed' || !entry.transactionId) continue;
      if (!isInvoiceLine(entry)) continue;
      const transaction = vault.transactions.get(entry.transactionId);
      if (!transaction) continue;

      if (invoiceId) {
        // Transferências e afins confirmados a partir do extrato não são compras
        // da fatura; o domínio recusa e a linha segue como está.
        vault.linkToInvoice(transaction.id, invoiceId);
      } else if (previous && transaction.invoiceId === previous) {
        vault.unlinkFromInvoice(transaction.id);
      }
    }

    batch.invoiceId = invoiceId;
    if (invoice && !invoice.cardLabel && batch.accountLabel) {
      invoice.cardLabel = batch.accountLabel;
      vault.invoicesTracker.registerDirty(invoice);
    }
    return right(true);
  }

  /**
   * A única fatura, ainda sem extrato, cujo valor e data batem com este
   * extrato. Mais de uma candidata é ambíguo: melhor deixar a escolha com o
   * usuário do que ligar à errada.
   */
  findInvoiceForStatement(
    vault: Vault,
    batches: ImportBatch[],
    batch: ImportBatch,
    entries: ImportEntry[],
  ): CardInvoice | null {
    const taken = new Set(batches.map((b) => b.invoiceId).filter(Boolean));
    const statement = this.summarizeStatement(batch, entries);
    const candidates = [...vault.invoices.values()].filter(
      (invoice) =>
        !taken.has(invoice.id) && statementMatchesInvoice(invoice, statement),
    );
    return candidates.length === 1 ? candidates[0] : null;
  }

  /** O inverso: o único extrato de cartão, ainda sem fatura, que bate com ela. */
  async findStatementForInvoice(
    invoice: CardInvoice,
    batches: ImportBatch[],
  ): Promise<{ batch: ImportBatch; entries: ImportEntry[] } | null> {
    const matches: { batch: ImportBatch; entries: ImportEntry[] }[] = [];
    for (const batch of batches) {
      if (batch.kind !== 'creditcard' || batch.invoiceId) continue;
      const entries = await this.importEntryRepository.findAllByBatchId(
        batch.id,
      );
      if (
        statementMatchesInvoice(
          invoice,
          this.summarizeStatement(batch, entries),
        )
      ) {
        matches.push({ batch, entries });
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }

  async listInvoices(
    vaultId: string,
  ): Promise<
    Either<
      string,
      { invoices: InvoiceView[]; unlinkedStatements: UnlinkedStatementView[] }
    >
  > {
    const vault = await this.vaultRepository.findById(vaultId);
    if (!vault) return left('Dados não encontrados');
    const batches = await this.importBatchRepository.findByVaultId(vaultId);

    const invoices = [...vault.invoices.values()]
      .sort((a, b) => b.paymentDate.getTime() - a.paymentDate.getTime())
      .map((invoice) => ({
        id: invoice.id,
        amount: invoice.amount,
        paymentDate: invoice.paymentDate,
        boxId: invoice.boxId,
        cardLabel: invoice.cardLabel,
        createdAt: invoice.createdAt,
        statements: batches
          .filter((b) => b.invoiceId === invoice.id)
          .map((b) => ({ batchId: b.id, accountLabel: b.accountLabel })),
        ...vault.getInvoiceBreakdown(invoice.id)!,
      }));

    const unlinkedStatements: UnlinkedStatementView[] = [];
    for (const batch of batches) {
      if (batch.kind !== 'creditcard' || batch.invoiceId) continue;
      const entries = await this.importEntryRepository.findAllByBatchId(
        batch.id,
      );
      let purchaseCount = 0;
      let totalCents = 0;
      for (const entry of entries) {
        if (entry.status !== 'confirmed' || !entry.transactionId) continue;
        if (!isInvoiceLine(entry)) continue;
        const transaction = vault.transactions.get(entry.transactionId);
        if (!transaction || transaction.invoiceId || transaction.transferId) {
          continue;
        }
        purchaseCount++;
        const cents = Math.round(transaction.amount * 100);
        totalCents += transaction.type === 'expense' ? cents : -cents;
      }
      if (purchaseCount === 0) continue;
      unlinkedStatements.push({
        batchId: batch.id,
        accountLabel: batch.accountLabel,
        periodStart: batch.periodStart,
        periodEnd: batch.periodEnd,
        purchaseCount,
        total: totalCents / 100,
      });
    }

    return right({ invoices, unlinkedStatements });
  }

  async setBatchInvoice(input: {
    vaultId: string;
    batchId: string;
    invoiceId: string | null;
  }): Promise<Either<string, ImportBatch>> {
    const batch = await this.importBatchRepository.findById(input.batchId);
    if (!batch || batch.vaultId !== input.vaultId) {
      return left('Importação não encontrada');
    }
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');

    const entries = await this.importEntryRepository.findAllByBatchId(batch.id);
    const [error] = this.applyBatchLink(vault, batch, entries, input.invoiceId);
    if (error !== null) return left(error);

    await this.vaultRepository.update(vault);
    await this.importBatchRepository.update(batch);
    return right(batch);
  }

  /**
   * Exclui a fatura e o não discriminado dela. As compras que estavam ligadas
   * voltam a contar na data em que foram feitas, e os extratos ficam sem fatura.
   */
  async deleteInvoice(input: {
    vaultId: string;
    invoiceId: string;
  }): Promise<Either<string, true>> {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');
    const [error] = vault.deleteInvoice(input.invoiceId);
    if (error !== null) return left(error);

    const batches = await this.importBatchRepository.findByVaultId(
      input.vaultId,
    );
    await this.vaultRepository.update(vault);
    for (const batch of batches) {
      if (batch.invoiceId !== input.invoiceId) continue;
      batch.invoiceId = null;
      await this.importBatchRepository.update(batch);
    }
    return right(true);
  }

  private summarizeStatement(batch: ImportBatch, entries: ImportEntry[]) {
    const lines = entries.filter(
      (e) => e.status !== 'dismissed' && isInvoiceLine(e),
    );
    const netCents = lines.reduce((sum, e) => {
      const cents = Math.round(e.amount * 100);
      return sum + (e.type === 'expense' ? cents : -cents);
    }, 0);
    const times = entries.map((e) => e.rawDate.getTime());
    return {
      ledgerBalance: batch.ledgerBalance,
      netTotal: netCents / 100,
      firstDate:
        batch.periodStart ??
        (times.length ? new Date(Math.min(...times)) : null),
      lastDate:
        batch.periodEnd ?? (times.length ? new Date(Math.max(...times)) : null),
    };
  }
}
