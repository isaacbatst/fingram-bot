import { Paginated } from '../domain/paginated';
import { TransactionDTO } from '../dto/transaction.dto,';

export interface AggregationTransaction {
  amount: number;
  type: 'income' | 'expense';
  boxId: string | null;
  allocationId: string | null;
  transferId: string | null;
  withdrawalType: 'withdrawal' | 'realization' | null;
}

export abstract class TransactionRepository {
  abstract findTransactionsByVaultId(
    vaultId: string,
    filter?: {
      dateRange?: {
        startDate: Date;
        endDate: Date;
      };
      categoryId?: string;
      description?: string;
      boxId?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<Paginated<TransactionDTO>>;

  abstract findCommittedByPeriod(
    vaultId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<AggregationTransaction[]>;

  /**
   * Quantas transações e quanto foi gasto em cada dia do intervalo.
   *
   * Agrupado no banco em vez de trazer as transações: o grid cobre meses e só
   * precisa de um número por dia.
   */
  abstract countByDay(
    vaultId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<DailyActivity[]>;
}

export interface DailyActivity {
  /** Dia em UTC, no formato YYYY-MM-DD. */
  date: string;
  count: number;
  expenseTotal: number;
}
