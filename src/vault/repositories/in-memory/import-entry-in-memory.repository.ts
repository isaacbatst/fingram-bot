/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import {
  ImportEntryRepository,
  ImportEntryStatusCounts,
} from '../import-entry.repository';
import { ImportEntry, ImportEntryStatus } from '@/vault/domain/import-entry';
import { Paginated } from '@/vault/domain/paginated';

@Injectable()
export class ImportEntryInMemoryRepository extends ImportEntryRepository {
  private entries = new Map<string, ImportEntry>();

  async createMany(entries: ImportEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
    }
  }

  async update(entry: ImportEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async findById(id: string): Promise<ImportEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async findExistingFitIds(
    vaultId: string,
    accountKey: string,
    fitIds: string[],
  ): Promise<Set<string>> {
    const wanted = new Set(fitIds);
    const found = [...this.entries.values()]
      .filter(
        (e) =>
          e.vaultId === vaultId &&
          e.accountKey === accountKey &&
          wanted.has(e.fitId),
      )
      .map((e) => e.fitId);
    return new Set(found);
  }

  async findByBatchId(
    batchId: string,
    options?: { status?: ImportEntryStatus; page?: number; pageSize?: number },
  ): Promise<Paginated<ImportEntry>> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 25;
    const all = [...this.entries.values()]
      .filter((e) => e.batchId === batchId)
      .filter((e) => !options?.status || e.status === options.status)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    return {
      items: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
    };
  }

  async findPendingByBatchId(batchId: string): Promise<ImportEntry[]> {
    return [...this.entries.values()]
      .filter((e) => e.batchId === batchId && e.status === 'pending')
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  async findAllByBatchId(batchId: string): Promise<ImportEntry[]> {
    return [...this.entries.values()]
      .filter((e) => e.batchId === batchId)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  async countByStatus(batchId: string): Promise<ImportEntryStatusCounts> {
    const counts: ImportEntryStatusCounts = {
      pending: 0,
      confirmed: 0,
      dismissed: 0,
    };
    for (const entry of this.entries.values()) {
      if (entry.batchId === batchId) counts[entry.status]++;
    }
    return counts;
  }

  async countPendingByVault(vaultId: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const entry of this.entries.values()) {
      if (entry.vaultId !== vaultId || entry.status !== 'pending') continue;
      counts.set(entry.batchId, (counts.get(entry.batchId) ?? 0) + 1);
    }
    return counts;
  }

  async findAllByVaultId(vaultId: string): Promise<ImportEntry[]> {
    return [...this.entries.values()]
      .filter((e) => e.vaultId === vaultId)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  async findByTransactionId(
    transactionId: string,
  ): Promise<ImportEntry | null> {
    return (
      [...this.entries.values()].find(
        (e) => e.transactionId === transactionId,
      ) ?? null
    );
  }
}
