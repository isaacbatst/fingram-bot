/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { Category } from '../../domain/category';
import { CategoryRepository } from '../category.repository';
import { InMemoryStore } from '@/shared/persistence/in-memory/in-memory-store';

@Injectable()
export class CategoryInMemoryRepository extends CategoryRepository {
  constructor(private store: InMemoryStore) {
    super();
  }

  async findAll(): Promise<Category[]> {
    return Array.from(this.store.categories.values());
  }

  async findById(id: string): Promise<Category | null> {
    return this.store.categories.get(id) ?? null;
  }
}
