/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { InMemoryStore } from '@/shared/persistence/in-memory/in-memory-store';
import { TransactionRepository } from '../transaction.repository';
import { Paginated } from '../../domain/paginated';
import { TransactionDTO } from '../../dto/transaction.dto,';

@Injectable()
export class TransactionInMemoryRepository extends TransactionRepository {
  constructor(private store: InMemoryStore) {
    super();
  }

  async findTransactionsByVaultId(
    vaultId: string,
    filter?: {
      date: { day?: number; month: number; year: number };
      page: number;
      pageSize?: number;
    },
  ): Promise<Paginated<TransactionDTO>> {
    const vault = this.store.vaults.get(vaultId);
    if (!vault) {
      return {
        items: [],
        total: 0,
        page: filter?.page ?? 1,
        pageSize: filter?.pageSize ?? 10,
        totalPages: 0,
      };
    }

    let transactions = Array.from(vault.transactions.values());

    if (filter?.date) {
      const { day, month, year } = filter.date;
      transactions = transactions.filter((transaction) => {
        const date = transaction.createdAt;
        return (
          date.getMonth() + 1 === month &&
          date.getFullYear() === year &&
          (day === undefined || date.getDate() === day)
        );
      });
    }

    const total = transactions.length;
    const page = filter?.page ?? 1;
    const pageSize = filter?.pageSize ?? 10;
    const totalPages = Math.ceil(total / pageSize);

    const startIndex = (page - 1) * pageSize;
    const paginatedTransactions = transactions.slice(
      startIndex,
      startIndex + pageSize,
    );

    const items: TransactionDTO[] = paginatedTransactions.map((transaction) => {
      const category = this.store.categories.get(
        transaction.categoryId as string,
      );
      return {
        id: transaction.id,
        code: transaction.code,
        description: transaction.description,
        amount: transaction.amount,
        isCommitted: transaction.isCommitted,
        createdAt: transaction.createdAt,
        type: transaction.type,
        category: category
          ? {
              id: category.id,
              name: category.name,
              code: category.code,
              description: category.description,
            }
          : null,
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }
}
