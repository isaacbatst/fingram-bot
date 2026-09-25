import { describe, it, expect, beforeEach } from 'vitest';
import { VaultService } from './vault.service';
import { InMemoryStore } from '@/shared/persistence/in-memory/in-memory-store';
import { CategoryInMemoryRepository } from './repositories/in-memory/category-in-memory.repository';

describe('VaultService categories', () => {
  let store: InMemoryStore;
  let service: VaultService;

  beforeEach(() => {
    store = new InMemoryStore();
    // Category methods only touch the category repository.
    const unused = {} as never;
    service = new VaultService(
      unused,
      unused,
      unused,
      new CategoryInMemoryRepository(store),
      unused,
      unused,
      unused,
      unused,
    );
  });

  describe('createCategory', () => {
    it('adds a category to the vault with the next code, after the base ones', async () => {
      const [err, created] = await service.createCategory({
        vaultId: 'v1',
        name: '  Pets ',
        description: ' ração, veterinário ',
        transactionType: 'expense',
      });
      expect(err).toBeNull();
      expect(created).toMatchObject({
        name: 'Pets',
        code: '13',
        description: 'ração, veterinário',
        transactionType: 'expense',
      });

      const categories = await service.getCategories('v1');
      expect(categories).toHaveLength(13);
      expect(categories.find((c) => c.id === created!.id)?.name).toBe('Pets');
    });

    it('only exists in its own vault', async () => {
      await service.createCategory({
        vaultId: 'v1',
        name: 'Pets',
        transactionType: 'expense',
      });
      const other = await service.getCategories('v2');
      expect(other).toHaveLength(12);
      expect(other.some((c) => c.name === 'Pets')).toBe(false);
    });

    it('rejects a name already used in the vault, ignoring accents and emoji', async () => {
      const [err] = await service.createCategory({
        vaultId: 'v1',
        name: 'saude',
        transactionType: 'expense',
      });
      expect(err).toBe('Já existe a categoria "🏥 Saúde"');
      expect(await service.getCategories('v1')).toHaveLength(12);
    });

    it('rejects an empty name', async () => {
      const [err] = await service.createCategory({
        vaultId: 'v1',
        name: '   ',
        transactionType: 'both',
      });
      expect(err).toMatch(/vazio/);
    });
  });

  describe('updateCategory', () => {
    it('changes only the fields sent, keeping id and code', async () => {
      const [, pets] = await service.createCategory({
        vaultId: 'v1',
        name: 'Pets',
        description: 'ração',
        transactionType: 'expense',
      });

      const [err, updated] = await service.updateCategory({
        vaultId: 'v1',
        categoryId: pets!.id,
        description: 'ração, veterinário, banho',
      });
      expect(err).toBeNull();
      expect(updated).toMatchObject({
        id: pets!.id,
        code: '13',
        name: 'Pets',
        description: 'ração, veterinário, banho',
        transactionType: 'expense',
      });
      const stored = (await service.getCategories('v1')).find(
        (c) => c.id === pets!.id,
      );
      expect(stored?.description).toBe('ração, veterinário, banho');
    });

    it('renames a base category', async () => {
      const base = (await service.getCategories('v1')).find(
        (c) => c.code === '6',
      )!;
      const [err, updated] = await service.updateCategory({
        vaultId: 'v1',
        categoryId: base.id,
        name: 'Lazer e viagens',
      });
      expect(err).toBeNull();
      expect(updated?.name).toBe('Lazer e viagens');
    });

    it('allows keeping the same name but rejects another category’s name', async () => {
      const [, pets] = await service.createCategory({
        vaultId: 'v1',
        name: 'Pets',
        transactionType: 'expense',
      });
      const [sameErr] = await service.updateCategory({
        vaultId: 'v1',
        categoryId: pets!.id,
        name: 'PETS',
      });
      expect(sameErr).toBeNull();

      const [clashErr] = await service.updateCategory({
        vaultId: 'v1',
        categoryId: pets!.id,
        name: 'Moradia',
      });
      expect(clashErr).toBe('Já existe a categoria "🏡 Moradia"');
    });

    it("cannot touch another vault's category", async () => {
      const [, pets] = await service.createCategory({
        vaultId: 'v1',
        name: 'Pets',
        transactionType: 'expense',
      });
      const [err] = await service.updateCategory({
        vaultId: 'v2',
        categoryId: pets!.id,
        name: 'Hackeado',
      });
      expect(err).toBe('Categoria não encontrada');
      const stored = (await service.getCategories('v1')).find(
        (c) => c.id === pets!.id,
      );
      expect(stored?.name).toBe('Pets');
    });
  });
});
