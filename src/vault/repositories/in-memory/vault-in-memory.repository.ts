/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { Vault } from '../../domain/vault';
import { VaultRepository } from '../vault.repository';
import { InMemoryStore } from './in-memory-store';

@Injectable()
export class VaultInMemoryRepository extends VaultRepository {
  constructor(private readonly store: InMemoryStore) {
    super();
  }

  async create(vault: Vault): Promise<void> {
    this.store.vaults.set(vault.id, vault);
  }

  async findById(id: string): Promise<Vault | null> {
    return this.store.vaults.get(id) ?? null;
  }

  async update(vault: Vault): Promise<void> {
    if (this.store.vaults.has(vault.id)) {
      this.store.vaults.set(vault.id, vault);
    }
  }

  async findByToken(token: string): Promise<Vault | null> {
    for (const vault of this.store.vaults.values()) {
      if (vault.token === token) {
        return vault;
      }
    }
    return null;
  }
}
