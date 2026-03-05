import { describe, it, expect } from 'vitest';
import { Box } from './box';

describe('Box', () => {
  it('should create a box with required fields', () => {
    const box = Box.create({ vaultId: 'vault-1', name: 'Nubank' });
    expect(box.id).toBeDefined();
    expect(box.vaultId).toBe('vault-1');
    expect(box.name).toBe('Nubank');
    expect(box.goalAmount).toBeNull();
    expect(box.isDefault).toBe(false);
    expect(box.createdAt).toBeInstanceOf(Date);
  });

  it('should create a box with goal amount', () => {
    const box = Box.create({
      vaultId: 'vault-1',
      name: 'Reserva',
      goalAmount: 10000,
    });
    expect(box.goalAmount).toBe(10000);
  });

  it('should create a default box', () => {
    const box = Box.create({
      vaultId: 'vault-1',
      name: 'Principal',
      isDefault: true,
    });
    expect(box.isDefault).toBe(true);
  });

  it('should restore a box from persisted data', () => {
    const box = Box.restore({
      id: 'box-1',
      vaultId: 'vault-1',
      name: 'Nubank',
      goalAmount: 5000,
      isDefault: false,
      createdAt: new Date('2026-01-01'),
    });
    expect(box.id).toBe('box-1');
    expect(box.goalAmount).toBe(5000);
  });
});
