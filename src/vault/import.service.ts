import { Injectable, Logger } from '@nestjs/common';
import { Either, left, right } from './domain/either';
import { ImportBatch } from './domain/import-batch';
import {
  ImportEntry,
  ImportEntryEdit,
  ImportEntryStatus,
  isSettlementDescription,
} from './domain/import-entry';
import { Transaction } from './domain/transaction';
import { Paginated } from './domain/paginated';
import { Vault } from './domain/vault';
import { VaultRepository } from './repositories/vault.repository';
import { BoxRepository } from './repositories/box.repository';
import { ImportBatchRepository } from './repositories/import-batch.repository';
import {
  ImportEntryRepository,
  ImportEntryStatusCounts,
} from './repositories/import-entry.repository';
import { OfxParseError, OfxStatement, parseOfx } from '@/shared/ofx-parser';

export type ImportReview = {
  batch: ImportBatch;
  counts: ImportEntryStatusCounts;
  /** Lines the file carried that this account had already seen. */
  duplicateCount: number;
  /** Lines dropped for falling before the cutoff the user chose. */
  outOfRangeCount: number;
  entries: Paginated<ImportEntry>;
};

/** Pending lines of one establishment — the unit the user actually decides on. */
export type ImportGroup = {
  key: string;
  description: string;
  type: 'income' | 'expense';
  count: number;
  totalAmount: number;
  firstDate: Date;
  lastDate: Date;
  entryIds: string[];
  /** Parece a quitação de uma fatura — não é gasto novo, e sim o pagamento dela. */
  looksLikeSettlement: boolean;
};

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly vaultRepository: VaultRepository,
    private readonly boxRepository: BoxRepository,
    private readonly importBatchRepository: ImportBatchRepository,
    private readonly importEntryRepository: ImportEntryRepository,
  ) {}

  /**
   * Reads an OFX file and stages every new line as a pending entry.
   *
   * Nothing becomes a transaction here: balances, budgets and the estrato are only
   * touched once the user confirms. Lines whose FITID this account has already seen
   * are skipped, which is what makes re-importing an overlapping period safe.
   *
   * `fromDate` is an optional cutoff: lines before it are dropped without leaving an
   * entry behind, so re-importing the same file without a cutoff brings them back.
   * That is deliberate — the user asked to start from a date, not to discard the
   * earlier days forever.
   */
  async ingest(input: {
    vaultId: string;
    file: Buffer;
    fileName?: string;
    boxId?: string;
    fromDate?: Date;
  }): Promise<Either<string, ImportBatch[]>> {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');

    let statements: OfxStatement[];
    try {
      statements = parseOfx(input.file);
    } catch (error) {
      if (error instanceof OfxParseError) return left(error.message);
      this.logger.error(`Falha ao ler OFX: ${String(error)}`);
      return left('Não foi possível ler o arquivo OFX');
    }

    if (input.boxId) {
      const box = await this.boxRepository.findById(input.boxId);
      if (!box || box.vaultId !== input.vaultId) {
        return left('Estrato não encontrado');
      }
    }

    const batches: ImportBatch[] = [];
    for (const statement of statements) {
      batches.push(await this.ingestStatement(input, statement));
    }
    return right(batches);
  }

  private async ingestStatement(
    input: {
      vaultId: string;
      fileName?: string;
      boxId?: string;
      fromDate?: Date;
    },
    statement: OfxStatement,
  ): Promise<ImportBatch> {
    const { accountKey } = statement.account;
    const boxId = await this.resolveBoxId(input.vaultId, accountKey, input.boxId);

    // The cutoff is applied before deduplication on purpose: a line dropped here
    // must not register its FITID, otherwise a later import without a cutoff would
    // treat it as already seen and never bring it back.
    const inRange = input.fromDate
      ? statement.transactions.filter(
          (t) => t.datePosted.getTime() >= input.fromDate!.getTime(),
        )
      : statement.transactions;

    const fitIds = inRange.map((t) => t.fitId);
    const known = await this.importEntryRepository.findExistingFitIds(
      input.vaultId,
      accountKey,
      fitIds,
    );
    const fresh = inRange.filter((t) => !known.has(t.fitId));

    const batch = ImportBatch.create({
      vaultId: input.vaultId,
      accountKey,
      accountLabel: this.buildAccountLabel(statement),
      boxId,
      kind: statement.kind,
      currency: statement.currency,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      ledgerBalance: statement.ledgerBalance,
      fileName: input.fileName ?? null,
      duplicateCount: inRange.length - fresh.length,
      fromDate: input.fromDate ?? null,
      outOfRangeCount: statement.transactions.length - inRange.length,
    });
    await this.importBatchRepository.create(batch);

    const entries = fresh.map((transaction) =>
      ImportEntry.create({
        vaultId: input.vaultId,
        batchId: batch.id,
        accountKey,
        boxId,
        fitId: transaction.fitId,
        rawDate: transaction.datePosted,
        rawAmount: transaction.amount,
        rawType: transaction.type,
        rawMemo: transaction.memo,
        rawName: transaction.name,
      }),
    );
    await this.importEntryRepository.createMany(entries);

    this.logger.log(
      `Lote ${batch.id}: ${entries.length} novos, ${batch.duplicateCount} já importados, ` +
        `${batch.outOfRangeCount} fora do período`,
    );
    return batch;
  }

  /**
   * The account → estrato binding is asked once per account: an explicit choice wins,
   * otherwise the estrato used on the previous import of the same account, otherwise
   * the vault's default estrato.
   */
  private async resolveBoxId(
    vaultId: string,
    accountKey: string,
    explicitBoxId?: string,
  ): Promise<string | null> {
    if (explicitBoxId) return explicitBoxId;

    const previous = await this.importBatchRepository.findLastByAccountKey(
      vaultId,
      accountKey,
    );
    if (previous?.boxId) return previous.boxId;

    const defaultBox = await this.boxRepository.findDefaultByVaultId(vaultId);
    return defaultBox?.id ?? null;
  }

  private buildAccountLabel(statement: OfxStatement): string {
    const { bankId, acctId } = statement.account;
    const kind = statement.kind === 'creditcard' ? 'Cartão' : 'Conta';
    return bankId ? `${kind} ${bankId} · ${acctId}` : `${kind} ${acctId}`;
  }

  async getReview(input: {
    vaultId: string;
    batchId: string;
    status?: ImportEntryStatus;
    page?: number;
    pageSize?: number;
  }): Promise<Either<string, ImportReview>> {
    const batch = await this.importBatchRepository.findById(input.batchId);
    if (!batch || batch.vaultId !== input.vaultId) {
      return left('Importação não encontrada');
    }

    const [counts, entries] = await Promise.all([
      this.importEntryRepository.countByStatus(batch.id),
      this.importEntryRepository.findByBatchId(batch.id, {
        status: input.status,
        page: input.page,
        pageSize: input.pageSize,
      }),
    ]);

    return right({
      batch,
      counts,
      duplicateCount: batch.duplicateCount,
      outOfRangeCount: batch.outOfRangeCount,
      entries,
    });
  }

  /**
   * Imports of a vault, each with how many lines are still awaiting a decision.
   *
   * The pending count is what lets the app offer a way back into a review left
   * halfway. Without it such a batch is unreachable: re-uploading the file does not
   * recover it, because deduplication refuses to recreate lines already seen.
   */
  async listBatches(
    vaultId: string,
  ): Promise<{ batch: ImportBatch; pendingCount: number }[]> {
    const [batches, pendingByBatch] = await Promise.all([
      this.importBatchRepository.findByVaultId(vaultId),
      this.importEntryRepository.countPendingByVault(vaultId),
    ]);

    return batches.map((batch) => ({
      batch,
      pendingCount: pendingByBatch.get(batch.id) ?? 0,
    }));
  }

  /**
   * The pending lines of a batch, collapsed by establishment.
   *
   * Classifying a statement line by line is the wrong unit of work: the same place
   * shows up many times in a month, and each repetition is not a new decision. One
   * group is one decision, which is what makes the review tractable.
   *
   * Type is part of the key so a group is never a mix of income and expense — the
   * category list differs between the two.
   */
  async getGroups(input: {
    vaultId: string;
    batchId: string;
  }): Promise<Either<string, ImportGroup[]>> {
    const batch = await this.importBatchRepository.findById(input.batchId);
    if (!batch || batch.vaultId !== input.vaultId) {
      return left('Importação não encontrada');
    }

    const pending = await this.importEntryRepository.findPendingByBatchId(
      batch.id,
    );

    const byKey = new Map<string, ImportEntry[]>();
    for (const entry of pending) {
      const key = `${entry.type}::${entry.matchKey}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(entry);
      else byKey.set(key, [entry]);
    }

    const groups = [...byKey.entries()].map(([key, entries]) => {
      const dates = entries.map((e) => e.date.getTime());
      return {
        key,
        // The raw text of the first line, kept readable instead of the normalized key.
        description: entries[0].rawMemo ?? entries[0].rawName ?? '',
        type: entries[0].type,
        count: entries.length,
        totalAmount: entries.reduce((sum, e) => sum + e.amount, 0),
        firstDate: new Date(Math.min(...dates)),
        lastDate: new Date(Math.max(...dates)),
        entryIds: entries.map((e) => e.id),
        looksLikeSettlement: isSettlementDescription(
          entries[0].rawMemo ?? entries[0].rawName ?? '',
          batch.kind,
        ),
      };
    });

    // Biggest groups first: the user clears the most lines with the fewest decisions,
    // and sees the count drop quickly.
    groups.sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);
    return right(groups);
  }

  /**
   * Sets a category on several entries at once, without confirming them.
   *
   * Keeping categorisation separate from confirmation is what makes the triage screen
   * safe to move fast in: nothing becomes a transaction until the user confirms at the
   * end, so going back and changing an answer costs nothing.
   */
  async categorizeEntries(input: {
    vaultId: string;
    entryIds: string[];
    categoryId: string | null;
  }): Promise<Either<string, { updated: number }>> {
    let updated = 0;
    for (const entryId of input.entryIds) {
      const entry = await this.loadEntry(input.vaultId, entryId);
      if (entry === null || entry.status !== 'pending') continue;

      const [error] = entry.edit({ categoryId: input.categoryId });
      if (error !== null) continue;

      await this.importEntryRepository.update(entry);
      updated++;
    }
    return right({ updated });
  }

  async editEntry(input: {
    vaultId: string;
    entryId: string;
    changes: ImportEntryEdit;
  }): Promise<Either<string, ImportEntry>> {
    const entry = await this.loadEntry(input.vaultId, input.entryId);
    if (entry === null) return left('Lançamento não encontrado');

    if (input.changes.boxId) {
      const box = await this.boxRepository.findById(input.changes.boxId);
      if (!box || box.vaultId !== input.vaultId) {
        return left('Estrato não encontrado');
      }
    }

    const [error] = entry.edit(input.changes);
    if (error !== null) return left(error);

    await this.importEntryRepository.update(entry);
    return right(entry);
  }

  async dismissEntry(input: {
    vaultId: string;
    entryId: string;
  }): Promise<Either<string, ImportEntry>> {
    const entry = await this.loadEntry(input.vaultId, input.entryId);
    if (entry === null) return left('Lançamento não encontrado');

    const [error] = entry.dismiss();
    if (error !== null) return left(error);

    await this.importEntryRepository.update(entry);
    return right(entry);
  }

  async confirmEntries(input: {
    vaultId: string;
    entryIds: string[];
  }): Promise<Either<string, { confirmed: number; skipped: string[] }>> {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');

    const defaultBox = await this.boxRepository.findDefaultByVaultId(
      input.vaultId,
    );

    const confirmed: ImportEntry[] = [];
    const skipped: string[] = [];

    for (const entryId of input.entryIds) {
      const entry = await this.loadEntry(input.vaultId, entryId);
      if (entry === null || entry.status !== 'pending') {
        skipped.push(entryId);
        continue;
      }
      this.materialize(vault, entry, defaultBox?.id ?? null);
      confirmed.push(entry);
    }

    // The vault aggregate is saved once for the whole batch, and no
    // TransactionCreatedEvent is emitted: confirming a hundred lines must not turn
    // into a hundred cross-channel notifications.
    await this.vaultRepository.update(vault);
    for (const entry of confirmed) {
      await this.importEntryRepository.update(entry);
    }

    return right({ confirmed: confirmed.length, skipped });
  }

  /**
   * Confirms entries as a transfer between the user's own estratos, instead of as a
   * plain transaction.
   *
   * A bank calls "transferência" both a PIX to another person and money moved to
   * your own savings. Only the second is a transfer here: the money is still yours,
   * so it must become a pair (out of one estrato, into the other) and leave the
   * balance untouched. Booking it as an expense would inflate the month's spending
   * and eat into a category budget for money that never left.
   *
   * Direction comes from the line itself: an expense leaves the account's estrato,
   * an income arrives in it.
   */
  async confirmAsTransfer(input: {
    vaultId: string;
    entryIds: string[];
    boxId: string;
  }): Promise<Either<string, { confirmed: number; skipped: string[] }>> {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');

    const counterpart = await this.boxRepository.findById(input.boxId);
    if (!counterpart || counterpart.vaultId !== input.vaultId) {
      return left('Estrato não encontrado');
    }

    const confirmed: ImportEntry[] = [];
    const skipped: string[] = [];

    for (const entryId of input.entryIds) {
      const entry = await this.loadEntry(input.vaultId, entryId);
      if (entry === null || entry.status !== 'pending' || !entry.boxId) {
        skipped.push(entryId);
        continue;
      }

      const fromBoxId =
        entry.type === 'expense' ? entry.boxId : input.boxId;
      const toBoxId = entry.type === 'expense' ? input.boxId : entry.boxId;

      const [error, transferId] = vault.createTransfer({
        fromBoxId,
        toBoxId,
        amount: entry.amount,
        date: entry.date,
      });
      if (error !== null) {
        skipped.push(entryId);
        continue;
      }

      // O par não expõe os ids das transações; vinculamos a entry ao lado que
      // ficou no estrato da própria conta, que é o que ela representa.
      const own = [...vault.transactions.values()].find(
        (t) => t.transferId === transferId && t.boxId === entry.boxId,
      );
      entry.confirm(own?.id ?? transferId);
      confirmed.push(entry);
    }

    await this.vaultRepository.update(vault);
    for (const entry of confirmed) {
      await this.importEntryRepository.update(entry);
    }

    return right({ confirmed: confirmed.length, skipped });
  }

  /** Confirms every still-pending entry of a batch. */
  async confirmBatch(input: {
    vaultId: string;
    batchId: string;
  }): Promise<Either<string, { confirmed: number; skipped: string[] }>> {
    const batch = await this.importBatchRepository.findById(input.batchId);
    if (!batch || batch.vaultId !== input.vaultId) {
      return left('Importação não encontrada');
    }

    const pending = await this.importEntryRepository.findPendingByBatchId(
      batch.id,
    );
    return this.confirmEntries({
      vaultId: input.vaultId,
      entryIds: pending.map((entry) => entry.id),
    });
  }

  async closeBatch(input: {
    vaultId: string;
    batchId: string;
  }): Promise<Either<string, ImportBatch>> {
    const batch = await this.importBatchRepository.findById(input.batchId);
    if (!batch || batch.vaultId !== input.vaultId) {
      return left('Importação não encontrada');
    }
    batch.markDone();
    await this.importBatchRepository.update(batch);
    return right(batch);
  }

  /**
   * Keeps an entry consistent when the transaction it produced is deleted.
   * The entry stays confirmed so a later re-import does not bring the line back.
   */
  async detachTransaction(transactionId: string): Promise<void> {
    const entry =
      await this.importEntryRepository.findByTransactionId(transactionId);
    if (!entry) return;
    entry.detachTransaction();
    await this.importEntryRepository.update(entry);
  }

  private materialize(
    vault: Vault,
    entry: ImportEntry,
    fallbackBoxId: string | null,
  ): void {
    const transaction = Transaction.create({
      vaultId: entry.vaultId,
      amount: entry.amount,
      type: entry.type,
      date: entry.date,
      description: entry.description,
      categoryId: entry.categoryId,
      boxId: entry.boxId ?? fallbackBoxId ?? undefined,
    });
    vault.addTransaction(transaction);
    vault.commitTransaction(transaction.id);
    entry.confirm(transaction.id);
  }

  private async loadEntry(
    vaultId: string,
    entryId: string,
  ): Promise<ImportEntry | null> {
    const entry = await this.importEntryRepository.findById(entryId);
    if (!entry || entry.vaultId !== vaultId) return null;
    return entry;
  }
}
