import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Category } from '../../domain/category';
import { CategoryRepository } from '../category.repository';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import { category } from '@/shared/persistence/drizzle/schema';

@Injectable()
export class CategoryDrizzleRepository extends CategoryRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  async findAll(): Promise<Category[]> {
    const rows = await this.db.select().from(category);
    return rows.map(
      (row) =>
        new Category(
          row.id,
          row.name,
          row.code,
          row.description ?? '',
          row.transactionType as 'income' | 'expense' | 'both',
        ),
    );
  }

  async findById(id: string): Promise<Category | null> {
    const rows = await this.db
      .select()
      .from(category)
      .where(eq(category.id, id));
    if (rows.length === 0) return null;
    const row = rows[0];
    return new Category(
      row.id,
      row.name,
      row.code,
      row.description ?? '',
      row.transactionType as 'income' | 'expense' | 'both',
    );
  }

  async findByCode(code: string): Promise<Category | null> {
    const rows = await this.db
      .select()
      .from(category)
      .where(eq(category.code, code));
    if (rows.length === 0) return null;
    const row = rows[0];
    return new Category(
      row.id,
      row.name,
      row.code,
      row.description ?? '',
      row.transactionType as 'income' | 'expense' | 'both',
    );
  }
}
