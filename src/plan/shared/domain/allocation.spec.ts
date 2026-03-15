import { describe, it, expect } from 'vitest';
import { Allocation } from './allocation';

describe('Allocation', () => {
  const baseParams = {
    planId: 'plan-1',
    label: 'Reserva Emergência',
    target: 50000,
    monthlyAmount: [{ month: 0, amount: 2500 }],
    holdsFunds: true,
    scheduledMovements: [],
  };

  it('creates with UUID and holdsFunds=true', () => {
    const alloc = Allocation.create(baseParams);
    expect(alloc.id).toBeDefined();
    expect(alloc.holdsFunds).toBe(true);
    expect(alloc.type).toBe('reserva');
    expect(alloc.estratoId).toBeNull();
  });

  it('creates Pagamento with holdsFunds=false', () => {
    const alloc = Allocation.create({ ...baseParams, holdsFunds: false });
    expect(alloc.type).toBe('pagamento');
  });

  it('bindToEstrato succeeds for Reserva', () => {
    const alloc = Allocation.create(baseParams);
    const [error] = alloc.bindToEstrato('box-1');
    expect(error).toBeNull();
    expect(alloc.estratoId).toBe('box-1');
  });

  it('bindToEstrato fails for Pagamento', () => {
    const alloc = Allocation.create({ ...baseParams, holdsFunds: false });
    const [error] = alloc.bindToEstrato('box-1');
    expect(error).not.toBeNull();
  });

  it('unbindEstrato clears the link', () => {
    const alloc = Allocation.create(baseParams);
    alloc.bindToEstrato('box-1');
    alloc.unbindEstrato();
    expect(alloc.estratoId).toBeNull();
  });

  it('restores from persisted data', () => {
    const alloc = Allocation.restore({
      id: 'alloc-1',
      planId: 'plan-1',
      label: 'Test',
      target: 1000,
      monthlyAmount: [],
      holdsFunds: true,
      scheduledMovements: [],
      estratoId: 'box-1',
      createdAt: new Date(),
    });
    expect(alloc.id).toBe('alloc-1');
    expect(alloc.estratoId).toBe('box-1');
  });
});
