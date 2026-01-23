/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { Category } from '../../domain/category';
import { CategoryRepository } from '../category.repository';
import { InMemoryStore } from '@/shared/persistence/in-memory/in-memory-store';
import * as crypto from 'crypto';

@Injectable()
export class CategoryInMemoryRepository extends CategoryRepository {
  constructor(private store: InMemoryStore) {
    super();
  }

  // Get all base categories (templates)
  async findAllBase(): Promise<Category[]> {
    return Array.from(this.store.categories.values());
  }

  // Get all categories for a specific vault
  async findAllByVaultId(vaultId: string): Promise<Category[]> {
    let vaultCategories = this.store.vaultCategories.get(vaultId);

    // If no vault categories exist, seed them from base categories
    if (!vaultCategories || vaultCategories.size === 0) {
      await this.seedForVault(vaultId);
      vaultCategories = this.store.vaultCategories.get(vaultId);
    }

    return vaultCategories ? Array.from(vaultCategories.values()) : [];
  }

  async findById(id: string): Promise<Category | null> {
    // Search through all vault categories
    for (const vaultCategories of this.store.vaultCategories.values()) {
      const category = vaultCategories.get(id);
      if (category) return category;
    }
    return null;
  }

  async findByCode(code: string, vaultId: string): Promise<Category | null> {
    const vaultCategories = this.store.vaultCategories.get(vaultId);
    if (!vaultCategories) return null;
    for (const category of vaultCategories.values()) {
      if (category.code === code) {
        return category;
      }
    }
    return null;
  }

  // Seed vault categories from base categories
  async seedForVault(vaultId: string): Promise<void> {
    // Check if already seeded
    const existing = this.store.vaultCategories.get(vaultId);
    if (existing && existing.size > 0) {
      return;
    }

    const baseCategories = Array.from(this.store.categories.values());
    const vaultCategories = new Map<string, Category>();

    for (const baseCat of baseCategories) {
      const newId = crypto.randomUUID();
      vaultCategories.set(
        newId,
        new Category(
          newId,
          baseCat.name,
          baseCat.code,
          baseCat.description,
          baseCat.transactionType,
        ),
      );
    }

    this.store.vaultCategories.set(vaultId, vaultCategories);
  }
}
