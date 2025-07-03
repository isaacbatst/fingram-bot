/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Inject } from '@nestjs/common';
import { Category } from '../../domain/category';
import { CategoryRepository } from '../category.repository';
import { SQLITE_DATABASE } from '@/shared/persistence/sqlite/sqlite.module';
import { Database } from 'better-sqlite3';
import { CategoryRow } from '@/shared/persistence/sqlite/rows';

@Injectable()
export class CategorySqliteRepository extends CategoryRepository {
  constructor(@Inject(SQLITE_DATABASE) private readonly db: Database) {
    super();
  }

  async findAll(): Promise<Category[]> {
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

  async findById(id: string): Promise<Category | null> {
    const row = this.db
      .prepare('SELECT * FROM category WHERE id = ?')
      .get(id) as CategoryRow | undefined;
    if (!row) return null;
    return new Category(
      row.id,
      row.name,
      row.code,
      row.description,
      row.transaction_type,
    );
  }

  async findByCode(code: string): Promise<Category | null> {
    const row = this.db
      .prepare('SELECT * FROM category WHERE code = ?')
      .get(code) as CategoryRow | undefined;
    if (!row) return null;
    return new Category(
      row.id,
      row.name,
      row.code,
      row.description,
      row.transaction_type,
    );
  }
}
