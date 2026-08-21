import { ImportBatch } from '../domain/import-batch';

export abstract class ImportBatchRepository {
  abstract create(batch: ImportBatch): Promise<void>;
  abstract update(batch: ImportBatch): Promise<void>;
  abstract findById(id: string): Promise<ImportBatch | null>;
  abstract findByVaultId(vaultId: string): Promise<ImportBatch[]>;
  /**
   * Most recent batch for an account, used to reuse the estrato the user already
   * chose for it — the binding is asked once per account, not per transaction.
   */
  abstract findLastByAccountKey(
    vaultId: string,
    accountKey: string,
  ): Promise<ImportBatch | null>;
}
