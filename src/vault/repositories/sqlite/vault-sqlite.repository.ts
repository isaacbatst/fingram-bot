/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Inject } from '@nestjs/common';
import { Vault } from '../../domain/vault';
import { VaultRepository } from '../vault.repository';
import { SQLITE_DATABASE } from '@/shared/persistence/sqlite/sqlite.module';
import { Database } from 'better-sqlite3';
import { VaultRow } from '@/shared/persistence/sqlite/rows';

@Injectable()
export class VaultSqliteRepository extends VaultRepository {
  constructor(@Inject(SQLITE_DATABASE) private readonly db: Database) {
    super();
  }

  async create(vault: Vault): Promise<void> {
    this.db
      .prepare('INSERT INTO vault (id, token, created_at) VALUES (?, ?, ?)')
      .run(vault.id, vault.token, vault.createdAt.toISOString());
  }

  async update(vault: Vault): Promise<void> {
    this.db
      .prepare('UPDATE vault SET token = ?, created_at = ? WHERE id = ?')
      .run(vault.token, vault.createdAt.toISOString(), vault.id);
  }

  async findById(id: string): Promise<Vault | null> {
    const row = this.db.prepare('SELECT * FROM vault WHERE id = ?').get(id) as
      | VaultRow
      | undefined;
    if (!row) return null;
    return new Vault(row.id, row.token, new Date(row.created_at));
  }

  async findByToken(token: string): Promise<Vault | null> {
    const row = this.db
      .prepare('SELECT * FROM vault WHERE token = ?')
      .get(token) as VaultRow | undefined;
    if (!row) return null;
    return new Vault(row.id, row.token, new Date(row.created_at));
  }
}
