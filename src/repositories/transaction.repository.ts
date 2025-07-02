import { Paginated } from '../domain/paginated';
import { TransactionDTO } from '../dto/transaction.dto,';

export abstract class TransactionRepository {
  abstract findTransactionsByVaultId(
    vaultId: string,
    filter?: {
      date?: {
        day?: number;
        month: number;
        year: number;
      };
      page?: number;
      pageSize?: number;
    },
  ): Promise<Paginated<TransactionDTO>>;
}
