import { Injectable, Inject } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import {
  ImportBatch,
  ImportAccountKind,
  ImportBatchStatus,
} from '../../domain/import-batch';
import { ImportBatchRepository } from '../import-batch.repository';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import { importBatch } from '@/shared/persistence/drizzle/schema';

type Row = typeof importBatch.$inferSelect;

@Injectable()
export class ImportBatchDrizzleRepository extends ImportBatchRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  private toDomain(row: Row): ImportBatch {
    return ImportBatch.restore({
      id: row.id,
      vaultId: row.vaultId,
      accountKey: row.accountKey,
      accountLabel: row.accountLabel,
      boxId: row.boxId,
      kind: row.kind as ImportAccountKind,
      currency: row.currency,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      ledgerBalance: row.ledgerBalance,
      fileName: row.fileName,
      status: row.status as ImportBatchStatus,
      duplicateCount: row.duplicateCount,
      fromDate: row.fromDate,
      outOfRangeCount: row.outOfRangeCount,
      invoiceId: row.invoiceId,
      noInvoice: row.noInvoice,
      createdAt: row.createdAt,
    });
  }

  private toRow(batch: ImportBatch) {
    return {
      id: batch.id,
      vaultId: batch.vaultId,
      accountKey: batch.accountKey,
      accountLabel: batch.accountLabel,
      boxId: batch.boxId,
      kind: batch.kind,
      currency: batch.currency,
      periodStart: batch.periodStart,
      periodEnd: batch.periodEnd,
      ledgerBalance: batch.ledgerBalance,
      fileName: batch.fileName,
      status: batch.status,
      duplicateCount: batch.duplicateCount,
      fromDate: batch.fromDate,
      outOfRangeCount: batch.outOfRangeCount,
      invoiceId: batch.invoiceId,
      noInvoice: batch.noInvoice,
      createdAt: batch.createdAt,
    };
  }

  async create(batch: ImportBatch): Promise<void> {
    await this.db.insert(importBatch).values(this.toRow(batch));
  }

  async update(batch: ImportBatch): Promise<void> {
    await this.db
      .update(importBatch)
      .set(this.toRow(batch))
      .where(eq(importBatch.id, batch.id));
  }

  async findById(id: string): Promise<ImportBatch | null> {
    const rows = await this.db
      .select()
      .from(importBatch)
      .where(eq(importBatch.id, id));
    return rows.length === 0 ? null : this.toDomain(rows[0]);
  }

  async findByVaultId(vaultId: string): Promise<ImportBatch[]> {
    const rows = await this.db
      .select()
      .from(importBatch)
      .where(eq(importBatch.vaultId, vaultId))
      .orderBy(desc(importBatch.createdAt));
    return rows.map((row) => this.toDomain(row));
  }

  async findLastByAccountKey(
    vaultId: string,
    accountKey: string,
  ): Promise<ImportBatch | null> {
    const rows = await this.db
      .select()
      .from(importBatch)
      .where(
        and(
          eq(importBatch.vaultId, vaultId),
          eq(importBatch.accountKey, accountKey),
        ),
      )
      .orderBy(desc(importBatch.createdAt))
      .limit(1);
    return rows.length === 0 ? null : this.toDomain(rows[0]);
  }
}
