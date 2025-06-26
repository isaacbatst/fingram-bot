/* eslint-disable @typescript-eslint/require-await */
import { Vault } from '../domain/vault';
import { VaultRepository } from './vault.repository';

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
}
