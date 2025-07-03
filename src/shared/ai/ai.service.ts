import { Action } from '@/vault/domain/action';
import { Category } from '@/vault/domain/category';
import { Either } from '@/vault/domain/either';
import { Transaction } from '@/vault/domain/transaction';

export abstract class AiService {
  abstract parseVaultAction(
    input: string,
    categories: Category[],
  ): Promise<Either<string, Action>>;
  abstract parseTransactionsFile(
    transactions: Transaction[],
    categories: Category[],
  ): Promise<Either<string, Map<string, string>>>;
}
