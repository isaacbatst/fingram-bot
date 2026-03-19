import { describe, it, expect } from 'vitest';
import { Vault } from './vault';
import { Transaction } from './transaction';
import { Category } from './category';
import { Box } from './box';

describe('Vault', () => {
  it('should add transactions', () => {
    const vault = new Vault();
    vault.addTransaction(
      Transaction.restore({
        id: '1',
        code: '1',
        vaultId: vault.id,
        boxId: '',
        transferId: null,
        allocationId: null,
        amount: 100,
        isCommitted: false,
        description: 'any',
        createdAt: new Date(),
        categoryId: 'any',
        type: 'income',
        date: new Date(),
      }),
    );
    expect(vault.getBalance()).toBe(0);
    vault.commitTransaction('1');
    expect(vault.getBalance()).toBe(100);
    vault.addTransaction(
      Transaction.restore({
        id: '2',
        code: '2',
        vaultId: vault.id,
        boxId: '',
        transferId: null,
        allocationId: null,
        amount: 50,
        isCommitted: false,
        description: 'any',
        createdAt: new Date(),
        categoryId: 'any',
        type: 'expense',
        date: new Date(),
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
        vaultId: vault.id,
        boxId: '',
        transferId: null,
        allocationId: null,
        amount: 100,
        isCommitted: false,
        description: 'any',
        createdAt: new Date(),
        categoryId: 'any',
        type: 'income',
        date: new Date(),
      }),
    );
    vault.commitTransaction('1');
    expect(vault.getBalance()).toBe(100);

    vault.editTransaction('1', { amount: 150 });
    expect(vault.getBalance()).toBe(150);
  });

  it('should delete a transaction and recalculate balance', () => {
    const vault = new Vault();
    vault.addTransaction(
      Transaction.restore({
        id: '1',
        code: '1',
        amount: 100,
        vaultId: vault.id,
        boxId: '',
        transferId: null,
        allocationId: null,
        isCommitted: false,
        description: 'any',
        createdAt: new Date(),
        categoryId: 'any',
        type: 'income',
        date: new Date(),
      }),
    );
    vault.commitTransaction('1');
    expect(vault.getBalance()).toBe(100);
    vault.deleteTransaction('1');
    expect(vault.getBalance()).toBe(0); // Após deletar, o saldo deve ser 0
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
        vaultId: vault.id,
        boxId: '',
        transferId: null,
        allocationId: null,
        amount: 100,
        isCommitted: false,
        categoryId: category1.id,
        createdAt: new Date('2022-05-15'),
        type: 'expense',
        date: new Date('2023-05-15'),
      }),
    );
    vault.addTransaction(
      Transaction.restore({
        id: '2',
        code: '2',
        amount: 150,
        vaultId: vault.id,
        boxId: '',
        transferId: null,
        allocationId: null,
        isCommitted: false,
        categoryId: category1.id,
        createdAt: new Date('2022-05-20'),
        date: new Date('2023-05-20'),
        type: 'expense',
      }),
    );
    vault.addTransaction(
      Transaction.restore({
        id: '3',
        code: '3',
        vaultId: vault.id,
        boxId: '',
        transferId: null,
        allocationId: null,
        amount: 50,
        isCommitted: false,
        categoryId: category2.id,
        createdAt: new Date('2022-05-02'),
        type: 'expense',
        date: new Date('2023-05-20'),
      }),
    );
    vault.addTransaction(
      Transaction.restore({
        id: '4',
        code: '4',
        vaultId: vault.id,
        boxId: '',
        transferId: null,
        allocationId: null,
        amount: 200,
        isCommitted: false,
        categoryId: category2.id,
        createdAt: new Date('2022-06-05'),
        date: new Date('2023-06-05'),
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

describe('Vault - Boxes', () => {
  it('should add a box', () => {
    const vault = new Vault();
    const box = Box.create({
      vaultId: vault.id,
      name: 'Emergência',
      goalAmount: 1000,
    });
    vault.addBox(box);

    expect(vault.boxes.size).toBe(1);
    expect(vault.boxes.get(box.id)).toBe(box);
    expect(vault.boxesTracker.getChanges().new).toHaveLength(1);
    expect(vault.boxesTracker.getChanges().new[0]).toBe(box);
  });

  it('should edit a box name and goalAmount', () => {
    const vault = new Vault();
    const box = Box.create({
      vaultId: vault.id,
      name: 'Emergência',
      goalAmount: 1000,
    });
    vault.addBox(box);

    const [err, editedBox] = vault.editBox(box.id, {
      name: 'Reserva',
      goalAmount: 2000,
    });
    expect(err).toBeNull();
    expect(editedBox!.name).toBe('Reserva');
    expect(editedBox!.goalAmount).toBe(2000);
    expect(vault.boxesTracker.getChanges().dirty).toHaveLength(1);
  });

  it('should not delete a default box', () => {
    const vault = new Vault();
    const box = Box.create({
      vaultId: vault.id,
      name: 'Padrão',
      isDefault: true,
    });
    vault.addBox(box);

    const [err] = vault.deleteBox(box.id);
    expect(err).toBe('Não é possível deletar o estrato padrão');
    expect(vault.boxes.size).toBe(1);
  });

  it('should not delete a box with transactions', () => {
    const vault = new Vault();
    const box = Box.create({ vaultId: vault.id, name: 'Viagem' });
    vault.addBox(box);

    vault.addTransaction(
      Transaction.restore({
        id: '1',
        code: '1',
        vaultId: vault.id,
        boxId: box.id,
        transferId: null,
        allocationId: null,
        amount: 100,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: null,
        type: 'income',
        date: new Date(),
      }),
    );

    const [err] = vault.deleteBox(box.id);
    expect(err).toBe('Não é possível deletar um estrato com transações');
    expect(vault.boxes.size).toBe(1);
  });

  it('should delete an empty non-default box', () => {
    const vault = new Vault();
    const box = Box.create({ vaultId: vault.id, name: 'Viagem' });
    vault.addBox(box);

    const [err, result] = vault.deleteBox(box.id);
    expect(err).toBeNull();
    expect(result).toBe(true);
    expect(vault.boxes.size).toBe(0);
    expect(vault.boxesTracker.getChanges().deleted).toHaveLength(1);
  });

  it('should calculate box balance', () => {
    const vault = new Vault();
    const box = Box.create({ vaultId: vault.id, name: 'Emergência' });
    vault.addBox(box);

    vault.addTransaction(
      Transaction.restore({
        id: '1',
        code: '1',
        vaultId: vault.id,
        boxId: box.id,
        transferId: null,
        allocationId: null,
        amount: 500,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: null,
        type: 'income',
        date: new Date(),
      }),
    );

    vault.addTransaction(
      Transaction.restore({
        id: '2',
        code: '2',
        vaultId: vault.id,
        boxId: box.id,
        transferId: null,
        allocationId: null,
        amount: 200,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: null,
        type: 'expense',
        date: new Date(),
      }),
    );

    // Uncommitted transaction should not count
    vault.addTransaction(
      Transaction.restore({
        id: '3',
        code: '3',
        vaultId: vault.id,
        boxId: box.id,
        transferId: null,
        allocationId: null,
        amount: 1000,
        isCommitted: false,
        createdAt: new Date(),
        categoryId: null,
        type: 'income',
        date: new Date(),
      }),
    );

    expect(vault.getBoxBalance(box.id)).toBe(300); // 500 - 200 = 300
  });

  it('should create transfer between boxes (balances correct, vault balance unchanged)', () => {
    const vault = new Vault();
    const boxA = Box.create({ vaultId: vault.id, name: 'Geral' });
    const boxB = Box.create({ vaultId: vault.id, name: 'Emergência' });
    vault.addBox(boxA);
    vault.addBox(boxB);

    // Seed boxA with 1000
    vault.addTransaction(
      Transaction.restore({
        id: 'seed',
        code: 'seed',
        vaultId: vault.id,
        boxId: boxA.id,
        transferId: null,
        allocationId: null,
        amount: 1000,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: null,
        type: 'income',
        date: new Date(),
      }),
    );

    const balanceBefore = vault.getBalance();

    const [err, transferId] = vault.createTransfer({
      fromBoxId: boxA.id,
      toBoxId: boxB.id,
      amount: 300,
      date: new Date(),
    });

    expect(err).toBeNull();
    expect(transferId).toBeDefined();

    // BoxA lost 300, boxB gained 300
    expect(vault.getBoxBalance(boxA.id)).toBe(700); // 1000 - 300
    expect(vault.getBoxBalance(boxB.id)).toBe(300); // 0 + 300

    // Overall vault balance should not change (transfer is internal)
    expect(vault.getBalance()).toBe(balanceBefore);
  });

  it('should delete a transfer (both transactions removed, balances restored)', () => {
    const vault = new Vault();
    const boxA = Box.create({ vaultId: vault.id, name: 'Geral' });
    const boxB = Box.create({ vaultId: vault.id, name: 'Emergência' });
    vault.addBox(boxA);
    vault.addBox(boxB);

    // Seed boxA with 1000
    vault.addTransaction(
      Transaction.restore({
        id: 'seed',
        code: 'seed',
        vaultId: vault.id,
        boxId: boxA.id,
        transferId: null,
        allocationId: null,
        amount: 1000,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: null,
        type: 'income',
        date: new Date(),
      }),
    );

    const [, transferId] = vault.createTransfer({
      fromBoxId: boxA.id,
      toBoxId: boxB.id,
      amount: 300,
      date: new Date(),
    });

    // Delete the transfer
    const [err, result] = vault.deleteTransfer(transferId!);
    expect(err).toBeNull();
    expect(result).toBe(true);

    // Balances should be restored
    expect(vault.getBoxBalance(boxA.id)).toBe(1000);
    expect(vault.getBoxBalance(boxB.id)).toBe(0);
  });

  it('should not transfer to the same box', () => {
    const vault = new Vault();
    const box = Box.create({ vaultId: vault.id, name: 'Geral' });
    vault.addBox(box);

    const [err] = vault.createTransfer({
      fromBoxId: box.id,
      toBoxId: box.id,
      amount: 100,
      date: new Date(),
    });

    expect(err).toBe('Não é possível transferir para o mesmo estrato');
  });

  it('should exclude transfers from budget calculations', () => {
    const vault = new Vault();
    const category = new Category('c1', 'Food', 'FOOD');
    vault.setBudget(category, 500);

    const boxA = Box.create({ vaultId: vault.id, name: 'A' });
    const boxB = Box.create({ vaultId: vault.id, name: 'B' });
    vault.addBox(boxA);
    vault.addBox(boxB);

    // Regular expense (should count in budget)
    vault.addTransaction(
      Transaction.restore({
        id: '1',
        code: '1',
        vaultId: vault.id,
        boxId: boxA.id,
        amount: 200,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: 'c1',
        type: 'expense',
        date: new Date('2026-03-15'),
        transferId: null,
        allocationId: null,
      }),
    );

    // Transfer expense (should NOT count in budget)
    vault.addTransaction(
      Transaction.restore({
        id: '2',
        code: '2',
        vaultId: vault.id,
        boxId: boxA.id,
        amount: 100,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: null,
        type: 'expense',
        date: new Date('2026-03-15'),
        transferId: 'tf-1',
        allocationId: null,
      }),
    );

    const summary = vault.getBudgetsSummary(3, 2026);
    expect(summary[0].spent).toBe(200); // Only regular expense, not transfer
  });

  it('should exclude transfers from totalSpentAmount', () => {
    const vault = new Vault();
    const boxA = Box.create({ vaultId: vault.id, name: 'A' });
    vault.addBox(boxA);

    vault.addTransaction(
      Transaction.restore({
        id: '1',
        code: '1',
        vaultId: vault.id,
        boxId: boxA.id,
        amount: 300,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: null,
        type: 'expense',
        date: new Date('2026-03-15'),
        transferId: null,
        allocationId: null,
      }),
    );

    vault.addTransaction(
      Transaction.restore({
        id: '2',
        code: '2',
        vaultId: vault.id,
        boxId: boxA.id,
        amount: 500,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: null,
        type: 'expense',
        date: new Date('2026-03-15'),
        transferId: 'tf-1',
        allocationId: null,
      }),
    );

    expect(vault.totalSpentAmount({ month: 3, year: 2026 })).toBe(300);
  });

  describe('totalSpentAmount with allocationId', () => {
    it('should exclude expenses with allocationId from totalSpentAmount', () => {
      const vault = new Vault();
      const box = Box.create({
        name: 'Principal',
        type: 'spending',
        isDefault: true,
        vaultId: vault.id,
      });
      vault.addBox(box);

      vault.addTransaction(
        Transaction.restore({
          id: 'spent-t1',
          code: 'b1',
          vaultId: vault.id,
          boxId: box.id,
          transferId: null,
          allocationId: null,
          amount: 500,
          isCommitted: true,
          description: 'Supermercado',
          createdAt: new Date(),
          date: new Date('2026-03-15'),
          categoryId: null,
          type: 'expense',
        }),
      );

      vault.addTransaction(
        Transaction.restore({
          id: 'spent-t2',
          code: 'b2',
          vaultId: vault.id,
          boxId: box.id,
          transferId: null,
          allocationId: 'alloc-1',
          amount: 1893,
          isCommitted: true,
          description: 'Parcela terreno',
          createdAt: new Date(),
          date: new Date('2026-03-15'),
          categoryId: null,
          type: 'expense',
        }),
      );

      expect(vault.totalSpentAmount({ month: 3, year: 2026 })).toBe(500);
    });
  });

  describe('getBudgetsSummary with allocationId', () => {
    it('should exclude expenses with allocationId from budget summary', () => {
      const vault = new Vault();
      const category = new Category('cat-alloc-1', 'Moradia', '1');
      vault.setBudget(category, 1000);

      const box = Box.create({
        name: 'Principal',
        type: 'spending',
        isDefault: true,
        vaultId: vault.id,
      });
      vault.addBox(box);

      // Regular expense — should count
      vault.addTransaction(
        Transaction.restore({
          id: 'alloc-t1',
          code: 'a1',
          vaultId: vault.id,
          boxId: box.id,
          transferId: null,
          allocationId: null,
          amount: 300,
          isCommitted: true,
          description: 'Aluguel',
          createdAt: new Date(),
          date: new Date('2026-03-15'),
          categoryId: 'cat-alloc-1',
          type: 'expense',
        }),
      );

      // Allocation-tagged expense — should NOT count
      vault.addTransaction(
        Transaction.restore({
          id: 'alloc-t2',
          code: 'a2',
          vaultId: vault.id,
          boxId: box.id,
          transferId: null,
          allocationId: 'alloc-1',
          amount: 1893,
          isCommitted: true,
          description: 'Parcela terreno',
          createdAt: new Date(),
          date: new Date('2026-03-15'),
          categoryId: 'cat-alloc-1',
          type: 'expense',
        }),
      );

      const summary = vault.getBudgetsSummary(3, 2026);
      const moradia = summary.find((s) => s.category.id === 'cat-alloc-1')!;
      expect(moradia.spent).toBe(300);
      expect(moradia.percentageUsed).toBe(30);
    });
  });

  describe('totalPlannedExpenses', () => {
    it('should return sum of expenses with allocationId from totalPlannedExpenses', () => {
      const vault = new Vault();
      const box = Box.create({
        name: 'Principal',
        type: 'spending',
        isDefault: true,
        vaultId: vault.id,
      });
      vault.addBox(box);

      vault.addTransaction(
        Transaction.restore({
          id: 'planned-t1',
          code: 'c1',
          vaultId: vault.id,
          boxId: box.id,
          transferId: null,
          allocationId: null,
          amount: 500,
          isCommitted: true,
          description: 'Supermercado',
          createdAt: new Date(),
          date: new Date('2026-03-15'),
          categoryId: null,
          type: 'expense',
        }),
      );

      vault.addTransaction(
        Transaction.restore({
          id: 'planned-t2',
          code: 'c2',
          vaultId: vault.id,
          boxId: box.id,
          transferId: null,
          allocationId: 'alloc-1',
          amount: 1893,
          isCommitted: true,
          description: 'Parcela terreno',
          createdAt: new Date(),
          date: new Date('2026-03-15'),
          categoryId: null,
          type: 'expense',
        }),
      );

      vault.addTransaction(
        Transaction.restore({
          id: 'planned-t3',
          code: 'c3',
          vaultId: vault.id,
          boxId: box.id,
          transferId: null,
          allocationId: 'alloc-2',
          amount: 200,
          isCommitted: true,
          description: 'Seguro',
          createdAt: new Date(),
          date: new Date('2026-03-15'),
          categoryId: null,
          type: 'expense',
        }),
      );

      expect(vault.totalPlannedExpenses({ month: 3, year: 2026 })).toBe(2093);
    });

    it('should include totalPlannedExpenses in toJSON serialization', () => {
      const vault = new Vault();
      const box = Box.create({
        name: 'Principal',
        type: 'spending',
        isDefault: true,
        vaultId: vault.id,
      });
      vault.addBox(box);

      vault.addTransaction(
        Transaction.restore({
          id: 'planned-t4',
          code: 'd1',
          vaultId: vault.id,
          boxId: box.id,
          transferId: null,
          allocationId: 'alloc-1',
          amount: 1000,
          isCommitted: true,
          description: 'Parcela',
          createdAt: new Date(),
          date: new Date('2026-03-15'),
          categoryId: null,
          type: 'expense',
        }),
      );

      const json = vault.toJSON({ date: { month: 3, year: 2026 } });
      expect(json.totalPlannedExpenses).toBe(1000);
    });
  });

  it('should exclude transfers from totalIncomeAmount', () => {
    const vault = new Vault();
    const boxA = Box.create({ vaultId: vault.id, name: 'A' });
    vault.addBox(boxA);

    vault.addTransaction(
      Transaction.restore({
        id: '1',
        code: '1',
        vaultId: vault.id,
        boxId: boxA.id,
        amount: 1000,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: null,
        type: 'income',
        date: new Date('2026-03-15'),
        transferId: null,
        allocationId: null,
      }),
    );

    vault.addTransaction(
      Transaction.restore({
        id: '2',
        code: '2',
        vaultId: vault.id,
        boxId: boxA.id,
        amount: 500,
        isCommitted: true,
        createdAt: new Date(),
        categoryId: null,
        type: 'income',
        date: new Date('2026-03-15'),
        transferId: 'tf-1',
        allocationId: null,
      }),
    );

    expect(vault.totalIncomeAmount({ month: 3, year: 2026 })).toBe(1000);
  });
});
