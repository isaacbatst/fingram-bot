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
}
