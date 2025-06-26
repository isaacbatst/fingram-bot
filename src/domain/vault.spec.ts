import { describe, it } from 'vitest';
import { Vault } from './vault';
import { Transaction } from './transaction';

describe('Vault', () => {
  it('should add transactions', () => {
    const vault = new Vault();
    vault.addTransaction(
      new Transaction('1', '1', 100, false, 'any', new Date(), 'any', 'income'),
    );
    expect(vault.getBalance()).toBe(0);
    vault.commitTransaction('1');
    expect(vault.getBalance()).toBe(100);
    vault.addTransaction(
      new Transaction('2', '2', 50, false, 'any', new Date(), 'any', 'expense'),
    );
    expect(vault.getBalance()).toBe(100);
    vault.commitTransaction('2');
    expect(vault.getBalance()).toBe(50);
  });

  it('should recalculate entry when editing a transaction', () => {
    const vault = new Vault();
    vault.addTransaction(
      new Transaction('1', '1', 100, false, 'any', new Date(), 'any', 'income'),
    );
    vault.commitTransaction('1');
    expect(vault.getBalance()).toBe(100);

    vault.editTransaction('1', 150);
    expect(vault.getBalance()).toBe(150);
  });
});
