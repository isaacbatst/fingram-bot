import { Action } from '@/vault/domain/action';
import { Category } from '@/vault/domain/category';
import { Either } from '@/vault/domain/either';
import { Transaction } from '@/vault/domain/transaction';

export abstract class AiService {
  abstract parseVaultAction(
    input: string,
    categories: Category[],
    customPrompt?: string,
    forceType?: 'income' | 'expense',
  ): Promise<Either<string, Action>>;
  abstract parseTransactionsFile(
    transactions: Transaction[],
    categories: Category[],
    customPrompt: string,
  ): Promise<Either<string, Map<string, string>>>;
}
