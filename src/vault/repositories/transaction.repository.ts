import { Paginated } from '../domain/paginated';
import { TransactionDTO } from '../dto/transaction.dto,';

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
      page?: number;
      pageSize?: number;
    },
  ): Promise<Paginated<TransactionDTO>>;
}
