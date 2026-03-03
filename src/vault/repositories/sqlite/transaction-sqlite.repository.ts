/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { TransactionRepository } from '../transaction.repository';
import { SQLITE_DATABASE } from '@/shared/persistence/sqlite/sqlite.module';
import { Database } from 'better-sqlite3';
import { Paginated } from '../../domain/paginated';
import { TransactionDTO } from '../../dto/transaction.dto,';
import { TransactionRow } from '@/shared/persistence/sqlite/rows';

type JoinedTransactionRow = TransactionRow &
  (
    | {
        category_id: string;
        category_name: string;
        category_code: string;
        category_description: string;
      }
    | {
        category_id: undefined;
        category_name: undefined;
        category_code: undefined;
        category_description: undefined;
      }
  ) & {
    transfer_to_box_id: string | null;
  };

@Injectable()
export class TransactionSqliteRepository extends TransactionRepository {
  private readonly logger = new Logger(TransactionSqliteRepository.name);
  constructor(@Inject(SQLITE_DATABASE) private readonly db: Database) {
    super();
  }

  async findTransactionsByVaultId(
    vaultId: string,
    filter?: {
      dateRange?: { startDate: Date; endDate: Date };
      categoryId?: string;
      description?: string;
      boxId?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<Paginated<TransactionDTO>> {
    const page = filter?.page ?? 1;
    const pageSize = filter?.pageSize ?? 10;
    const offset = (page - 1) * pageSize;
    let query = `SELECT t.*, c.id as category_id, c.name as category_name, c.code as category_code, c.description as category_description, it.box_id as transfer_to_box_id
                 FROM "transaction" t
                 LEFT JOIN vault_category c ON t.category_id = c.id
                 LEFT JOIN "transaction" it ON it.transfer_id = t.transfer_id AND it.type = 'income' AND t.transfer_id IS NOT NULL
                 WHERE t.vault_id = ?
                 AND (t.transfer_id IS NULL OR t.type = 'expense')`;
    const params: unknown[] = [vaultId];
    if (filter?.dateRange) {
      query += ' AND t.date >= ? AND t.date <= ?';
      params.push(filter.dateRange.startDate.toISOString());
      params.push(filter.dateRange.endDate.toISOString());
    }
    if (filter?.categoryId) {
      query += ' AND t.category_id = ?';
      params.push(filter.categoryId);
    }
    if (filter?.description) {
      query += ' AND LOWER(t.description) LIKE LOWER(?)';
      params.push(`%${filter.description}%`);
    }
    if (filter?.boxId) {
      query += ' AND (t.box_id = ? OR it.box_id = ?)';
      params.push(filter.boxId, filter.boxId);
    }
    query += ' ORDER BY t.date DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
    const rows = this.db
      .prepare(query)
      .all(...params) as JoinedTransactionRow[];
    const items = rows.map<TransactionDTO>((row) => ({
      id: row.id,
      vaultId: row.vault_id,
      boxId: (row as any).box_id ?? '',
      transferId: (row as any).transfer_id ?? null,
      transferToBoxId: row.transfer_to_box_id ?? null,
      code: row.code,
      date: new Date(row.date),
      description: row.description,
      amount: row.amount,
      isCommitted: !!row.committed,
      createdAt: new Date(row.created_at),
      type: row.type,
      category: row.category_id
        ? {
            id: row.category_id,
            name: row.category_name,
            code: row.category_code,
            description: row.category_description,
          }
        : null,
    }));
    let countQuery = `SELECT COUNT(*) as count FROM "transaction" t
       LEFT JOIN "transaction" it ON it.transfer_id = t.transfer_id AND it.type = 'income' AND t.transfer_id IS NOT NULL
       WHERE t.vault_id = ?
       AND (t.transfer_id IS NULL OR t.type = 'expense')`;
    const countParams: unknown[] = [vaultId];
    if (filter?.categoryId) {
      countQuery += ' AND t.category_id = ?';
      countParams.push(filter.categoryId);
    }
    if (filter?.description) {
      countQuery += ' AND LOWER(t.description) LIKE LOWER(?)';
      countParams.push(`%${filter.description}%`);
    }
    if (filter?.dateRange) {
      countQuery += ' AND t.date >= ? AND t.date <= ?';
      countParams.push(filter.dateRange.startDate.toISOString());
      countParams.push(filter.dateRange.endDate.toISOString());
    }
    if (filter?.boxId) {
      countQuery += ' AND (t.box_id = ? OR it.box_id = ?)';
      countParams.push(filter.boxId, filter.boxId);
    }
    const total = (
      this.db.prepare(countQuery).get(...countParams) as { count: number }
    ).count;
    const totalPages = Math.ceil(total / pageSize);
    return { items, total, page, pageSize, totalPages };
  }
}
