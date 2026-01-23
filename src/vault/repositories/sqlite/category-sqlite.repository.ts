/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Inject } from '@nestjs/common';
import { Category } from '../../domain/category';
import { CategoryRepository } from '../category.repository';
import { SQLITE_DATABASE } from '@/shared/persistence/sqlite/sqlite.module';
import { Database } from 'better-sqlite3';
import { CategoryRow, VaultCategoryRow } from '@/shared/persistence/sqlite/rows';
import * as crypto from 'crypto';

@Injectable()
export class CategorySqliteRepository extends CategoryRepository {
  constructor(@Inject(SQLITE_DATABASE) private readonly db: Database) {
    super();
  }

  // Get all base categories (templates)
  async findAllBase(): Promise<Category[]> {
    const rows = this.db
      .prepare('SELECT * FROM category')
      .all() as CategoryRow[];
    return rows.map(
      (row) =>
        new Category(
          row.id,
          row.name,
          row.code,
          row.description,
          row.transaction_type,
        ),
    );
  }

  // Get all categories for a specific vault
  async findAllByVaultId(vaultId: string): Promise<Category[]> {
    let rows = this.db
      .prepare('SELECT * FROM vault_category WHERE vault_id = ?')
      .all(vaultId) as VaultCategoryRow[];

    // If no vault categories exist, seed them from base categories
    if (rows.length === 0) {
      await this.seedForVault(vaultId);
      rows = this.db
        .prepare('SELECT * FROM vault_category WHERE vault_id = ?')
        .all(vaultId) as VaultCategoryRow[];
    }

    return rows.map(
      (row) =>
        new Category(
          row.id,
          row.name,
          row.code,
          row.description,
          row.transaction_type,
        ),
    );
  }

  async findById(id: string): Promise<Category | null> {
    const row = this.db
      .prepare('SELECT * FROM vault_category WHERE id = ?')
      .get(id) as VaultCategoryRow | undefined;
    if (!row) return null;
    return new Category(
      row.id,
      row.name,
      row.code,
      row.description,
      row.transaction_type,
    );
  }

  async findByCode(code: string, vaultId: string): Promise<Category | null> {
    const row = this.db
      .prepare('SELECT * FROM vault_category WHERE code = ? AND vault_id = ?')
      .get(code, vaultId) as VaultCategoryRow | undefined;
    if (!row) return null;
    return new Category(
      row.id,
      row.name,
      row.code,
      row.description,
      row.transaction_type,
    );
  }

  // Seed vault categories from base categories
  async seedForVault(vaultId: string): Promise<void> {
    // Check if vault already has categories
    const existing = this.db
      .prepare('SELECT 1 FROM vault_category WHERE vault_id = ? LIMIT 1')
      .get(vaultId);

    if (existing) {
      // Already seeded
      return;
    }

    const baseCategories = this.db
      .prepare('SELECT * FROM category')
      .all() as CategoryRow[];

    const stmt = this.db.prepare(
      `INSERT INTO vault_category (id, vault_id, base_category_id, name, code, description, transaction_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const baseCat of baseCategories) {
      stmt.run(
        crypto.randomUUID(),
        vaultId,
        baseCat.id,
        baseCat.name,
        baseCat.code,
        baseCat.description,
        baseCat.transaction_type,
      );
    }
  }
}
