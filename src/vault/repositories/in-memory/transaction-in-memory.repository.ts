/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { InMemoryStore } from '@/shared/persistence/in-memory/in-memory-store';
import {
  TransactionRepository,
  AggregationTransaction,
} from '../transaction.repository';
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
      dateRange?: { startDate: Date; endDate: Date };
      categoryId?: string;
      description?: string;
      boxId?: string;
      page?: number;
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

    if (filter?.dateRange) {
      const { startDate, endDate } = filter.dateRange;
      transactions = transactions.filter((transaction) => {
        const date = transaction.date ?? transaction.createdAt;
        return date >= startDate && date <= endDate;
      });
    }

    if (filter?.categoryId) {
      transactions = transactions.filter(
        (transaction) => transaction.categoryId === filter.categoryId,
      );
    }

    if (filter?.description) {
      transactions = transactions.filter((transaction) =>
        transaction.description
          ?.toLowerCase()
          .includes(filter.description!.toLowerCase()),
      );
    }

    // All transactions (before exclusion) for looking up income pairs
    const allVaultTransactions = Array.from(vault.transactions.values());

    if (filter?.boxId) {
      transactions = transactions.filter((transaction) => {
        if (transaction.boxId === filter.boxId) return true;
        // Also include expense-side transfers whose income pair targets the filtered box
        if (transaction.transferId && transaction.type === 'expense') {
          const incomePair = allVaultTransactions.find(
            (t) =>
              t.transferId === transaction.transferId && t.type === 'income',
          );
          return incomePair?.boxId === filter.boxId;
        }
        return false;
      });
    }

    // Exclude income-side of transfers (keep only expense side or non-transfers)
    transactions = transactions.filter(
      (t) => !t.transferId || t.type === 'expense',
    );

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

      // Find transferToBoxId from the paired income transaction
      let transferToBoxId: string | null = null;
      if (transaction.transferId) {
        const incomePair = allVaultTransactions.find(
          (t) => t.transferId === transaction.transferId && t.type === 'income',
        );
        transferToBoxId = incomePair?.boxId ?? null;
      }

      return {
        id: transaction.id,
        vaultId: vault.id,
        boxId: transaction.boxId,
        transferId: transaction.transferId,
        transferToBoxId,
        code: transaction.code,
        date: transaction.date,
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
        allocationId: transaction.allocationId ?? null,
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

  async findCommittedByPeriod(
    vaultId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<AggregationTransaction[]> {
    const vault = this.store.vaults.get(vaultId);
    if (!vault) return [];

    const transactions = Array.from(vault.transactions.values());
    return transactions
      .filter((t) => {
        if (!t.isCommitted) return false;
        const date = t.date ?? t.createdAt;
        return date >= startDate && date < endDate;
      })
      .map((t) => ({
        amount: t.amount,
        type: t.type,
        boxId: t.boxId || null,
        allocationId: t.allocationId ?? null,
        transferId: t.transferId ?? null,
        withdrawalType: t.withdrawalType ?? null,
      }));
  }
}
