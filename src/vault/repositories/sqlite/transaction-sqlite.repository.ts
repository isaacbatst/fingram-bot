/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Inject } from '@nestjs/common';
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
  );

@Injectable()
export class TransactionSqliteRepository extends TransactionRepository {
  constructor(@Inject(SQLITE_DATABASE) private readonly db: Database) {
    super();
  }

  async findTransactionsByVaultId(
    vaultId: string,
    filter?: {
      date?: { day?: number; month: number; year: number };
      page?: number;
      pageSize?: number;
    },
  ): Promise<Paginated<TransactionDTO>> {
    const page = filter?.page ?? 1;
    const pageSize = filter?.pageSize ?? 10;
    const offset = (page - 1) * pageSize;
    let query = `SELECT t.*, c.id as category_id, c.name as category_name, c.code as category_code, c.description as category_description
                 FROM "transaction" t
                 LEFT JOIN category c ON t.category_id = c.id
                 WHERE t.vault_id = ?`;
    const params: unknown[] = [vaultId];
    if (filter?.date) {
      query +=
        " AND strftime('%m', t.created_at) = ? AND strftime('%Y', t.created_at) = ?";
      params.push(String(filter.date.month).padStart(2, '0'));
      params.push(String(filter.date.year));
      if (filter.date.day !== undefined) {
        query += " AND strftime('%d', t.created_at) = ?";
        params.push(String(filter.date.day).padStart(2, '0'));
      }
    }
    query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
    const rows = this.db
      .prepare(query)
      .all(...params) as JoinedTransactionRow[];
    const items = rows.map<TransactionDTO>((row) => ({
      id: row.id,
      code: row.code,
      vaultId: row.vault_id,
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
    const total = (
      this.db
        .prepare(
          'SELECT COUNT(*) as count FROM "transaction" t WHERE t.vault_id = ?',
        )
        .get(vaultId) as { count: number }
    ).count;
    const totalPages = Math.ceil(total / pageSize);
    return { items, total, page, pageSize, totalPages };
  }
}
