import { Paginated } from '../domain/paginated';
import { ImportEntry, ImportEntryStatus } from '../domain/import-entry';

export type ImportEntryStatusCounts = Record<ImportEntryStatus, number>;

export abstract class ImportEntryRepository {
  abstract createMany(entries: ImportEntry[]): Promise<void>;
  abstract update(entry: ImportEntry): Promise<void>;
  abstract findById(id: string): Promise<ImportEntry | null>;
  /**
   * Which of these FITIDs this account has already seen, in any state. Backs the
   * idempotent re-import: a line already decided must not come back.
   */
  abstract findExistingFitIds(
    vaultId: string,
    accountKey: string,
    fitIds: string[],
  ): Promise<Set<string>>;
  abstract findByBatchId(
    batchId: string,
    options?: { status?: ImportEntryStatus; page?: number; pageSize?: number },
  ): Promise<Paginated<ImportEntry>>;
  abstract findPendingByBatchId(batchId: string): Promise<ImportEntry[]>;
  abstract countByStatus(batchId: string): Promise<ImportEntryStatusCounts>;
  /** Used to detach an entry when the transaction it created is deleted. */
  abstract findByTransactionId(
    transactionId: string,
  ): Promise<ImportEntry | null>;
}
