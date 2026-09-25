import { Category } from '../domain/category';

export abstract class CategoryRepository {
  // Base categories (templates)
  abstract findAllBase(): Promise<Category[]>;

  // Vault-specific categories
  abstract findAllByVaultId(vaultId: string): Promise<Category[]>;
  abstract findById(id: string): Promise<Category | null>;
  abstract findByCode(code: string, vaultId: string): Promise<Category | null>;

  // Custom vault categories (no base category behind them)
  abstract create(vaultId: string, category: Category): Promise<void>;
  // Updates name, description and transactionType of a category in the vault
  abstract update(vaultId: string, category: Category): Promise<void>;

  // Seed vault categories from base categories
  abstract seedForVault(vaultId: string): Promise<void>;
}
