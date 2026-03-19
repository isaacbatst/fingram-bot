import { describe, it, expect } from 'vitest';
import { Allocation } from './allocation';

describe('Allocation', () => {
  const baseParams = {
    planId: 'plan-1',
    label: 'Reserva Emergência',
    target: 50000,
    monthlyAmount: [{ month: 0, amount: 2500 }],
    realizationMode: 'manual' as const,
    scheduledMovements: [],
  };

  it('creates with UUID and realizationMode=manual (Reserva)', () => {
    const alloc = Allocation.create(baseParams);
    expect(alloc.id).toBeDefined();
    expect(alloc.realizationMode).toBe('manual');
    expect(alloc.type).toBe('reserva');
    expect(alloc.estratoId).toBeNull();
  });

  it('creates Pagamento with realizationMode=immediate', () => {
    const alloc = Allocation.create({
      ...baseParams,
      realizationMode: 'immediate',
    });
    expect(alloc.type).toBe('pagamento');
  });

  it('bindToEstrato succeeds for Reserva', () => {
    const alloc = Allocation.create(baseParams);
    const [error] = alloc.bindToEstrato('box-1');
    expect(error).toBeNull();
    expect(alloc.estratoId).toBe('box-1');
  });

  it('bindToEstrato fails for Pagamento', () => {
    const alloc = Allocation.create({
      ...baseParams,
      realizationMode: 'immediate',
    });
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
      realizationMode: 'manual',
      scheduledMovements: [],
      estratoId: 'box-1',
      createdAt: new Date(),
    });
    expect(alloc.id).toBe('alloc-1');
    expect(alloc.estratoId).toBe('box-1');
  });
});
