import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, sql, ilike, desc, count } from 'drizzle-orm';
import { TransactionRepository } from '../transaction.repository';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import { transaction, vaultCategory } from '@/shared/persistence/drizzle/schema';
import { Paginated } from '../../domain/paginated';
import { TransactionDTO } from '../../dto/transaction.dto,';

@Injectable()
export class TransactionDrizzleRepository extends TransactionRepository {
  private readonly logger = new Logger(TransactionDrizzleRepository.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  async findTransactionsByVaultId(
    vaultId: string,
    filter?: {
      date?: { day?: number; month: number; year: number };
      categoryId?: string;
      description?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<Paginated<TransactionDTO>> {
    const page = filter?.page ?? 1;
    const pageSize = filter?.pageSize ?? 10;
    const offset = (page - 1) * pageSize;

    // Build where conditions
    const conditions = [eq(transaction.vaultId, vaultId)];

    if (filter?.date) {
      conditions.push(
        sql`EXTRACT(MONTH FROM ${transaction.date}) = ${filter.date.month}`,
      );
      conditions.push(
        sql`EXTRACT(YEAR FROM ${transaction.date}) = ${filter.date.year}`,
      );
      if (filter.date.day !== undefined) {
        conditions.push(
          sql`EXTRACT(DAY FROM ${transaction.date}) = ${filter.date.day}`,
        );
      }
    }

    if (filter?.categoryId) {
      conditions.push(eq(transaction.categoryId, filter.categoryId));
    }

    if (filter?.description) {
      conditions.push(ilike(transaction.description, `%${filter.description}%`));
    }

    // Query with join to vault categories
    const rows = await this.db
      .select({
        id: transaction.id,
        code: transaction.code,
        amount: transaction.amount,
        type: transaction.type,
        categoryId: transaction.categoryId,
        vaultId: transaction.vaultId,
        description: transaction.description,
        createdAt: transaction.createdAt,
        committed: transaction.committed,
        date: transaction.date,
        categoryName: vaultCategory.name,
        categoryCode: vaultCategory.code,
        categoryDescription: vaultCategory.description,
      })
      .from(transaction)
      .leftJoin(vaultCategory, eq(transaction.categoryId, vaultCategory.id))
      .where(and(...conditions))
      .orderBy(desc(transaction.date))
      .limit(pageSize)
      .offset(offset);

    const items = rows.map<TransactionDTO>((row) => ({
      id: row.id,
      vaultId: row.vaultId,
      code: row.code,
      date: row.date ?? row.createdAt,
      description: row.description ?? undefined,
      amount: row.amount,
      isCommitted: row.committed,
      createdAt: row.createdAt,
      type: row.type as 'expense' | 'income',
      category: row.categoryId
        ? {
            id: row.categoryId,
            name: row.categoryName!,
            code: row.categoryCode!,
            description: row.categoryDescription ?? '',
          }
        : null,
    }));

    // Count total
    const countResult = await this.db
      .select({ count: count() })
      .from(transaction)
      .where(and(...conditions));

    const total = countResult[0]?.count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    return { items, total, page, pageSize, totalPages };
  }
}
