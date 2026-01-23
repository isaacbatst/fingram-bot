import { Category } from '../domain/category';

export abstract class CategoryRepository {
  // Base categories (templates)
  abstract findAllBase(): Promise<Category[]>;

  // Vault-specific categories
  abstract findAllByVaultId(vaultId: string): Promise<Category[]>;
  abstract findById(id: string): Promise<Category | null>;
  abstract findByCode(code: string, vaultId: string): Promise<Category | null>;

  // Seed vault categories from base categories
  abstract seedForVault(vaultId: string): Promise<void>;
}
