import {describe, it} from 'vitest';
import { Vault } from './vault';
import { Transaction } from './transaction';

describe('Vault', () => {
  it('should add transactions', () => {
    const vault = new Vault();
    vault.addTransaction(new Transaction('1', 100));
    expect(vault.getBalance()).toBe(0);
    vault.commitTransaction('1');
    expect(vault.getBalance()).toBe(100);
    vault.addTransaction(new Transaction('2', -50));
    expect(vault.getBalance()).toBe(100);
    vault.commitTransaction('2');
    expect(vault.getBalance()).toBe(50);
  })
});