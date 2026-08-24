import { Injectable } from '@nestjs/common';
import { ImportBatchRepository } from '../import-batch.repository';
import { ImportBatch } from '@/vault/domain/import-batch';

@Injectable()
export class ImportBatchInMemoryRepository extends ImportBatchRepository {
  private batches = new Map<string, ImportBatch>();

  async create(batch: ImportBatch): Promise<void> {
    this.batches.set(batch.id, batch);
  }

  async update(batch: ImportBatch): Promise<void> {
    this.batches.set(batch.id, batch);
  }

  async findById(id: string): Promise<ImportBatch | null> {
    return this.batches.get(id) ?? null;
  }

  async findByVaultId(vaultId: string): Promise<ImportBatch[]> {
    return [...this.batches.values()]
      .filter((b) => b.vaultId === vaultId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findLastByAccountKey(
    vaultId: string,
    accountKey: string,
  ): Promise<ImportBatch | null> {
    return (
      [...this.batches.values()]
        .filter((b) => b.vaultId === vaultId && b.accountKey === accountKey)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }
}
