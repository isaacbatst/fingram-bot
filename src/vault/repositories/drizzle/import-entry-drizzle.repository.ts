import { Injectable, Inject } from '@nestjs/common';
import { eq, and, inArray, asc, count } from 'drizzle-orm';
import { ImportEntry, ImportEntryStatus } from '../../domain/import-entry';
import {
  ImportEntryRepository,
  ImportEntryStatusCounts,
} from '../import-entry.repository';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import { importEntry } from '@/shared/persistence/drizzle/schema';
import { Paginated } from '@/vault/domain/paginated';
import { SuggestionSource } from '../../domain/import-entry';

type Row = typeof importEntry.$inferSelect;

@Injectable()
export class ImportEntryDrizzleRepository extends ImportEntryRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  private toDomain(row: Row): ImportEntry {
    return ImportEntry.restore({
      id: row.id,
      batchId: row.batchId,
      vaultId: row.vaultId,
      accountKey: row.accountKey,
      fitId: row.fitId,
      rawDate: row.rawDate,
      rawAmount: row.rawAmount,
      rawType: row.rawType as 'income' | 'expense',
      rawMemo: row.rawMemo,
      rawName: row.rawName,
      date: row.date,
      amount: row.amount,
      type: row.type as 'income' | 'expense',
      description: row.description ?? '',
      categoryId: row.categoryId,
      allocationId: row.allocationId,
      boxId: row.boxId,
      suggestedCategoryId: row.suggestedCategoryId,
      suggestionSource: row.suggestionSource as SuggestionSource,
      status: row.status as ImportEntryStatus,
      transactionId: row.transactionId,
      createdAt: row.createdAt,
    });
  }

  private toRow(entry: ImportEntry) {
    return {
      id: entry.id,
      batchId: entry.batchId,
      vaultId: entry.vaultId,
      accountKey: entry.accountKey,
      fitId: entry.fitId,
      rawDate: entry.rawDate,
      rawAmount: entry.rawAmount,
      rawType: entry.rawType,
      rawMemo: entry.rawMemo,
      rawName: entry.rawName,
      date: entry.date,
      amount: entry.amount,
      type: entry.type,
      description: entry.description,
      categoryId: entry.categoryId,
      allocationId: entry.allocationId,
      boxId: entry.boxId,
      suggestedCategoryId: entry.suggestedCategoryId,
      suggestionSource: entry.suggestionSource,
      status: entry.status,
      transactionId: entry.transactionId,
      createdAt: entry.createdAt,
    };
  }

  async createMany(entries: ImportEntry[]): Promise<void> {
    if (entries.length === 0) return;
    // The service already filters known FITIDs; ignoring conflicts here keeps two
    // concurrent uploads of the same file from failing the whole ingestion.
    await this.db
      .insert(importEntry)
      .values(entries.map((entry) => this.toRow(entry)))
      .onConflictDoNothing();
  }

  async update(entry: ImportEntry): Promise<void> {
    await this.db
      .update(importEntry)
      .set(this.toRow(entry))
      .where(eq(importEntry.id, entry.id));
  }

  async findById(id: string): Promise<ImportEntry | null> {
    const rows = await this.db
      .select()
      .from(importEntry)
      .where(eq(importEntry.id, id));
    return rows.length === 0 ? null : this.toDomain(rows[0]);
  }

  async findExistingFitIds(
    vaultId: string,
    accountKey: string,
    fitIds: string[],
  ): Promise<Set<string>> {
    if (fitIds.length === 0) return new Set();
    const rows = await this.db
      .select({ fitId: importEntry.fitId })
      .from(importEntry)
      .where(
        and(
          eq(importEntry.vaultId, vaultId),
          eq(importEntry.accountKey, accountKey),
          inArray(importEntry.fitId, fitIds),
        ),
      );
    return new Set(rows.map((row) => row.fitId));
  }

  async findByBatchId(
    batchId: string,
    options?: { status?: ImportEntryStatus; page?: number; pageSize?: number },
  ): Promise<Paginated<ImportEntry>> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 25;
    const where = options?.status
      ? and(
          eq(importEntry.batchId, batchId),
          eq(importEntry.status, options.status),
        )
      : eq(importEntry.batchId, batchId);

    const [totalRow] = await this.db
      .select({ value: count() })
      .from(importEntry)
      .where(where);
    const total = totalRow?.value ?? 0;

    const rows = await this.db
      .select()
      .from(importEntry)
      .where(where)
      .orderBy(asc(importEntry.date))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: rows.map((row) => this.toDomain(row)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findPendingByBatchId(batchId: string): Promise<ImportEntry[]> {
    const rows = await this.db
      .select()
      .from(importEntry)
      .where(
        and(
          eq(importEntry.batchId, batchId),
          eq(importEntry.status, 'pending'),
        ),
      )
      .orderBy(asc(importEntry.date));
    return rows.map((row) => this.toDomain(row));
  }

  async findAllByBatchId(batchId: string): Promise<ImportEntry[]> {
    const rows = await this.db
      .select()
      .from(importEntry)
      .where(eq(importEntry.batchId, batchId))
      .orderBy(asc(importEntry.date));
    return rows.map((row) => this.toDomain(row));
  }

  async countByStatus(batchId: string): Promise<ImportEntryStatusCounts> {
    const rows = await this.db
      .select({ status: importEntry.status, value: count() })
      .from(importEntry)
      .where(eq(importEntry.batchId, batchId))
      .groupBy(importEntry.status);

    const counts: ImportEntryStatusCounts = {
      pending: 0,
      confirmed: 0,
      dismissed: 0,
    };
    for (const row of rows) {
      counts[row.status as ImportEntryStatus] = row.value;
    }
    return counts;
  }

  async countPendingByVault(vaultId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ batchId: importEntry.batchId, value: count() })
      .from(importEntry)
      .where(
        and(
          eq(importEntry.vaultId, vaultId),
          eq(importEntry.status, 'pending'),
        ),
      )
      .groupBy(importEntry.batchId);

    return new Map(rows.map((row) => [row.batchId, row.value]));
  }

  async findByTransactionId(
    transactionId: string,
  ): Promise<ImportEntry | null> {
    const rows = await this.db
      .select()
      .from(importEntry)
      .where(eq(importEntry.transactionId, transactionId));
    return rows.length === 0 ? null : this.toDomain(rows[0]);
  }
}
