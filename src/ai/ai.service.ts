import { Action } from '../domain/action';
import { Category } from '../domain/category';
import { Either } from '../domain/either';
import { Transaction } from '../domain/transaction';

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
