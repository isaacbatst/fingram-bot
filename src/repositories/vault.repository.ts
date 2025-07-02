import { Paginated } from '../domain/paginated';
import { Transaction } from '../domain/transaction';
import { Vault } from '../domain/vault';

export abstract class VaultRepository {
  abstract create(vault: Vault): Promise<void>;
  abstract update(vault: Vault): Promise<void>;
  abstract findById(id: string): Promise<Vault | null>;
  abstract findByToken(token: string): Promise<Vault | null>;
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
  ): Promise<Paginated<Transaction>>;
}
