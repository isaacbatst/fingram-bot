import { describe, expect, it } from 'vitest';
import { TelegramMessageGenerator } from './telegram-message-generator';
import { Vault } from '../domain/vault';
import { Category } from '../domain/category';
import { Transaction } from '../domain/transaction';

describe('TelegramMessageGenerator', () => {
  const generator = new TelegramMessageGenerator();
  const createdAt = '2023-01-01T03:00:00Z';

  function addTransactionToVault(
    vault: Vault,
    category: Category,
    amount: number,
    description: string,
  ): void {
    const transaction = Transaction.create({
      amount,
      description,
    });
    transaction.categoryId = category.id;
    vault.addTransaction(transaction);
    vault.commitTransaction(transaction.id);
  }

  describe('formatTransactionSuccessMessage', () => {
    it('should format income transaction success message', () => {
      const vault = new Vault('token123', createdAt);
      const transaction = {
        amount: 1000,
        description: 'Salário',
        createdAt: new Date(createdAt),
        categoryName: 'Renda',
      };

      const message = generator.formatTransactionSuccessMessage(
        vault,
        transaction,
      );

      expect(message).toContain('🟢 *Receita registrada com sucesso\\!*');
      expect(message).toContain('*Valor:* R$\u00A01\\.000,00');
      expect(message).toContain('*Descrição:* Salário');
      expect(message).toContain('*Categoria:* Renda');
      expect(message).toContain('*Saldo atual:* R$\u00A00,00');
    });

    it('should format expense transaction success message', () => {
      const vault = new Vault('token123', createdAt);
      const transaction = {
        amount: -500,
        description: 'Aluguel',
        createdAt: new Date(createdAt),
        categoryName: 'Moradia',
      };

      const message = generator.formatTransactionSuccessMessage(
        vault,
        transaction,
      );

      expect(message).toContain('🔴 *Despesa registrada com sucesso\\!*');
      expect(message).toContain('*Valor:* R$\u00A0500,00');
      expect(message).toContain('*Descrição:* Aluguel');
      expect(message).toContain('*Categoria:* Moradia');
      expect(message).toContain('*Saldo atual:* R$\u00A00,00');
    });

    it('should handle transaction without description', () => {
      const vault = new Vault('token123', createdAt);
      const transaction = {
        amount: 1000,
        createdAt: new Date(createdAt),
        categoryName: 'Renda',
      };

      const message = generator.formatTransactionSuccessMessage(
        vault,
        transaction,
      );

      expect(message).not.toContain('*Descrição:*');
    });

    it('should handle transaction without category', () => {
      const vault = new Vault('token123', createdAt);
      const transaction = {
        amount: 1000,
        createdAt: new Date(createdAt),
        categoryName: null,
      };

      const message = generator.formatTransactionSuccessMessage(
        vault,
        transaction,
      );

      expect(message).toContain('*Categoria:* Nenhuma categoria especificada');
    });
  });

  describe('formatVault', () => {
    it('should format vault without budgets', () => {
      const vault = new Vault('id', 'token123', new Date(createdAt));
      const message = generator.formatVault(vault);

      expect(message).toContain('💰 Cofre');
      expect(message).toContain('Token: token123');
      expect(message).toContain('Criado em: 01/01/2023');
      expect(message).toContain('Saldo atual: R$\u00A00,00');
      expect(message).toContain('Nenhum orçamento definido\\.');
    });

    it('should format vault with budgets', () => {
      const vault = new Vault('token123', createdAt);
      const category = new Category(
        'id',
        '🏠 Moradia',
        'cat1',
        'Aluguel e contas',
      );
      vault.setBudget(category, 1000);
      addTransactionToVault(vault, category, -500, 'Aluguel');

      const message = generator.formatVault(vault);

      expect(message).toContain('Orçamentos:');
      expect(message).toContain(
        '• `#cat1` 🏠 Moradia \\| Orçamento: R$\u00A01\\.000,00',
      );
      expect(message).toContain('Gastos: R$\u00A0500,00');
      expect(message).toContain('50%');
    });

    it('should show progress bar correctly', () => {
      const vault = new Vault('token123', createdAt);
      const category = new Category(
        'cat1',
        '🏠',
        'Moradia',
        'Aluguel e contas',
      );
      vault.setBudget(category, 1000);
      addTransactionToVault(vault, category, -800, 'Aluguel');

      const message = generator.formatVault(vault);

      expect(message).toContain('████████░░ 80%');
    });

    it('should cap progress bar at 100%', () => {
      const vault = new Vault('token123', createdAt);
      const category = new Category(
        'cat1',
        '🏠',
        'Moradia',
        'Aluguel e contas',
      );
      vault.setBudget(category, 1000);
      addTransactionToVault(vault, category, -1500, 'Aluguel');

      const message = generator.formatVault(vault);

      expect(message).toContain('██████████ 100%');
    });
  });
});
