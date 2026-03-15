import { describe, it, expect } from 'vitest';
import { Transaction } from './transaction';

describe('Transaction', () => {
  it('should create a transaction with boxId', () => {
    const tx = Transaction.create({
      amount: 100,
      vaultId: 'vault-1',
      boxId: 'box-1',
      date: new Date(),
      type: 'expense',
    });
    expect(tx.boxId).toBe('box-1');
    expect(tx.transferId).toBeNull();
  });

  it('should create a transfer transaction with transferId', () => {
    const tx = Transaction.create({
      amount: 500,
      vaultId: 'vault-1',
      boxId: 'box-1',
      date: new Date(),
      type: 'expense',
      transferId: 'transfer-abc',
    });
    expect(tx.transferId).toBe('transfer-abc');
  });

  it('should default boxId to empty string if not provided', () => {
    const tx = Transaction.create({
      amount: 100,
      vaultId: 'vault-1',
      date: new Date(),
      type: 'expense',
    });
    expect(tx.boxId).toBe('');
  });

  it('should restore a transaction with boxId and transferId', () => {
    const tx = Transaction.restore({
      id: 'tx-1',
      code: 'ab12',
      vaultId: 'vault-1',
      boxId: 'box-1',
      transferId: 'transfer-abc',
      amount: 100,
      isCommitted: true,
      createdAt: new Date(),
      categoryId: null,
      type: 'expense',
      date: new Date(),
      allocationId: null,
    });
    expect(tx.boxId).toBe('box-1');
    expect(tx.transferId).toBe('transfer-abc');
  });

  it('should create a transaction with allocationId', () => {
    const tx = Transaction.create({
      amount: 200,
      vaultId: 'vault-1',
      date: new Date(),
      type: 'expense',
      allocationId: 'alloc-1',
    });
    expect(tx.allocationId).toBe('alloc-1');
  });

  it('should default allocationId to null if not provided', () => {
    const tx = Transaction.create({
      amount: 100,
      vaultId: 'vault-1',
      date: new Date(),
      type: 'expense',
    });
    expect(tx.allocationId).toBeNull();
  });

  it('should include allocationId in toDTO', () => {
    const tx = Transaction.create({
      amount: 100,
      vaultId: 'vault-1',
      date: new Date(),
      type: 'expense',
      allocationId: 'alloc-42',
    });
    const dto = tx.toDTO(null);
    expect(dto.allocationId).toBe('alloc-42');
  });
});
