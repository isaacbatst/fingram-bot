import { describe, it } from 'vitest';
import { Vault } from './vault';
import { Transaction } from './transaction';
import { Category } from './category';

describe('Vault', () => {
  it('should add transactions', () => {
    const vault = new Vault();
    vault.addTransaction(
      Transaction.restore({
        id: '1',
        code: '1',
        amount: 100,
        isCommitted: false,
        description: 'any',
        createdAt: new Date(),
        categoryId: 'any',
        type: 'income',
      }),
    );
    expect(vault.getBalance()).toBe(0);
    vault.commitTransaction('1');
    expect(vault.getBalance()).toBe(100);
    vault.addTransaction(
      Transaction.restore({
        id: '2',
        code: '2',
        amount: 50,
        isCommitted: false,
        description: 'any',
        createdAt: new Date(),
        categoryId: 'any',
        type: 'expense',
      }),
    );
    expect(vault.getBalance()).toBe(100);
    vault.commitTransaction('2');
    expect(vault.getBalance()).toBe(50);
  });

  it('should recalculate entry when editing a transaction', () => {
    const vault = new Vault();
    vault.addTransaction(
      Transaction.restore({
        id: '1',
        code: '1',
        amount: 100,
        isCommitted: false,
        description: 'any',
        createdAt: new Date(),
        categoryId: 'any',
        type: 'income',
      }),
    );
    vault.commitTransaction('1');
    expect(vault.getBalance()).toBe(100);

    vault.editTransaction('1', 150);
    expect(vault.getBalance()).toBe(150);
  });

  it('should generate summary for a specific month and year', () => {
    const vault = new Vault();
    const category1 = new Category('1', 'Category1', '1');
    const category2 = new Category('2', 'Category2', '2');
    vault.setBudget(category1, 500);
    vault.setBudget(category2, 300);
    vault.addTransaction(
      Transaction.restore({
        id: '1',
        code: '1',
        amount: 100,
        isCommitted: false,
        categoryId: category1.id,
        createdAt: new Date('2023-05-15'),
        type: 'expense',
      }),
    );
    vault.addTransaction(
      Transaction.restore({
        id: '2',
        code: '2',
        amount: 150,
        isCommitted: false,
        categoryId: category1.id,
        createdAt: new Date('2023-05-20'),
        type: 'expense',
      }),
    );
    vault.addTransaction(
      Transaction.restore({
        id: '3',
        code: '3',
        amount: 50,
        isCommitted: false,
        categoryId: category2.id,
        createdAt: new Date('2023-05-02'),
        type: 'expense',
      }),
    );
    vault.addTransaction(
      Transaction.restore({
        id: '4',
        code: '4',
        amount: 200,
        isCommitted: false,
        categoryId: category2.id,
        createdAt: new Date('2023-06-05'),
        type: 'expense',
      }),
    );

    vault.commitTransaction('1');
    vault.commitTransaction('2');
    vault.commitTransaction('3');
    vault.commitTransaction('4');

    const summaryMay2023 = vault.getBudgetsSummary(5, 2023);
    expect(summaryMay2023).toHaveLength(2);
    expect(summaryMay2023[0].category.name).toBe('Category1');
    expect(summaryMay2023[0].spent).toBe(250); // Total gasto em Maio (100 + 150)
    expect(summaryMay2023[1].category.name).toBe('Category2');
    expect(summaryMay2023[1].spent).toBe(50); // Total gasto em Maio (200)

    // Resumo para Junho de 2023
    const summaryJune2023 = vault.getBudgetsSummary(6, 2023);
    expect(summaryJune2023).toHaveLength(2);
    expect(summaryJune2023[0].category.name).toBe('Category1');
    expect(summaryJune2023[0].spent).toBe(0); // Nenhuma transação em Junho para Alimentação
    expect(summaryJune2023[1].category.name).toBe('Category2');
    expect(summaryJune2023[1].spent).toBe(200); // Total gasto em Junho (50)
  });
});
