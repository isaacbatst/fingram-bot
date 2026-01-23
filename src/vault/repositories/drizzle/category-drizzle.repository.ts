import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { Category } from '../../domain/category';
import { CategoryRepository } from '../category.repository';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import { category, vaultCategory } from '@/shared/persistence/drizzle/schema';
import * as crypto from 'crypto';

@Injectable()
export class CategoryDrizzleRepository extends CategoryRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  // Get all base categories (templates)
  async findAllBase(): Promise<Category[]> {
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

  // Get all categories for a specific vault
  async findAllByVaultId(vaultId: string): Promise<Category[]> {
    let rows = await this.db
      .select()
      .from(vaultCategory)
      .where(eq(vaultCategory.vaultId, vaultId));

    // If no vault categories exist, seed them from base categories
    if (rows.length === 0) {
      await this.seedForVault(vaultId);
      rows = await this.db
        .select()
        .from(vaultCategory)
        .where(eq(vaultCategory.vaultId, vaultId));
    }

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

  // Find a specific vault category by id
  async findById(id: string): Promise<Category | null> {
    const rows = await this.db
      .select()
      .from(vaultCategory)
      .where(eq(vaultCategory.id, id));
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

  // Find a vault category by code within a vault
  async findByCode(code: string, vaultId: string): Promise<Category | null> {
    const rows = await this.db
      .select()
      .from(vaultCategory)
      .where(
        and(eq(vaultCategory.code, code), eq(vaultCategory.vaultId, vaultId)),
      );
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

  // Seed vault categories from base categories
  async seedForVault(vaultId: string): Promise<void> {
    // Check if vault already has categories
    const existingCategories = await this.db
      .select()
      .from(vaultCategory)
      .where(eq(vaultCategory.vaultId, vaultId))
      .limit(1);

    if (existingCategories.length > 0) {
      // Already seeded
      return;
    }

    const baseCategories = await this.db.select().from(category);

    for (const baseCat of baseCategories) {
      await this.db.insert(vaultCategory).values({
        id: crypto.randomUUID(),
        vaultId,
        baseCategoryId: baseCat.id,
        name: baseCat.name,
        code: baseCat.code,
        description: baseCat.description ?? '',
        transactionType: baseCat.transactionType,
      });
    }
  }
}
