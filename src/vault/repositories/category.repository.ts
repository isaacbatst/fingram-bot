import { Category } from '../domain/category';

export abstract class CategoryRepository {
  abstract findAll(): Promise<Category[]>;
  abstract findById(id: string): Promise<Category | null>;
}
