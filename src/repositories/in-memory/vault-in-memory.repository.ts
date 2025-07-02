/* eslint-disable @typescript-eslint/require-await */
import { Paginated } from '../../domain/paginated';
import { Transaction } from '../../domain/transaction';
import { Vault } from '../../domain/vault';
import { VaultRepository } from '../vault.repository';

export class VaultInMemoryRepository extends VaultRepository {
  private vaults: Map<string, Vault> = new Map();

  async create(vault: Vault): Promise<void> {
    this.vaults.set(vault.id, vault);
  }

  async findById(id: string): Promise<Vault | null> {
    return this.vaults.get(id) ?? null;
  }

  async update(vault: Vault): Promise<void> {
    if (this.vaults.has(vault.id)) {
      this.vaults.set(vault.id, vault);
    }
  }

  async findByToken(token: string): Promise<Vault | null> {
    for (const vault of this.vaults.values()) {
      if (vault.token === token) {
        return vault;
      }
    }
    return null;
  }
  async findTransactionsByVaultId(
    vaultId: string,
    filter?: {
      date: { day?: number; month: number; year: number };
      page: number;
      pageSize?: number;
    },
  ): Promise<Paginated<Transaction>> {
    const vault = this.vaults.get(vaultId);
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
    const items = transactions.slice(startIndex, startIndex + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }
}
