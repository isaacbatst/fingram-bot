import { describe, it, expect } from 'vitest';
import { Plan } from './plan';
import { runProjection } from './run-projection';

function createPlan(
  overrides: Partial<Parameters<typeof Plan.create>[0]> = {},
): Plan {
  return Plan.create({
    vaultId: 'vault-1',
    name: 'Test Plan',
    startDate: new Date('2026-01-01'),
    premises: { salary: 10000 },
    phases: [
      {
        id: 'default',
        name: 'Default',
        startMonth: 0,
        endMonth: 119,
        monthlyCost: 6000,
      },
    ],
    fundAllocation: [
      { fundId: 'emergency', label: 'Emergencia', target: 10000, priority: 1 },
      { fundId: 'car', label: 'Carro', target: 20000, priority: 2 },
      { fundId: 'free', label: 'Livre', target: 0, priority: 3 },
    ],
    ...overrides,
  });
}

describe('runProjection', () => {
  it('should calculate basic surplus correctly', () => {
    const plan = createPlan();
    const result = runProjection(plan, 1);

    expect(result).toHaveLength(1);
    expect(result[0].income).toBe(10000);
    expect(result[0].expenses).toBe(6000);
    expect(result[0].surplus).toBe(4000);
  });

  it('should return correct month numbers and dates', () => {
    const plan = createPlan({
      startDate: new Date(2026, 2, 1), // March 1, 2026 (local time)
    });
    const result = runProjection(plan, 3);

    expect(result[0].month).toBe(1);
    expect(result[0].date.getFullYear()).toBe(2026);
    expect(result[0].date.getMonth()).toBe(2); // March = 2

    expect(result[1].month).toBe(2);
    expect(result[1].date.getMonth()).toBe(3); // April = 3

    expect(result[2].month).toBe(3);
    expect(result[2].date.getMonth()).toBe(4); // May = 4
  });

  it('should allocate surplus via waterfall (priority order)', () => {
    const plan = createPlan({
      premises: { salary: 10000 },
      phases: [
        {
          id: 'p1',
          name: 'Phase 1',
          startMonth: 0,
          endMonth: 119,
          monthlyCost: 6000,
        },
      ],
      fundAllocation: [
        {
          fundId: 'emergency',
          label: 'Emergencia',
          target: 10000,
          priority: 1,
        },
        { fundId: 'car', label: 'Carro', target: 5000, priority: 2 },
      ],
    });

    // Surplus = 4000/month
    // Month 1: emergency gets 4000 (total: 4000)
    // Month 2: emergency gets 4000 (total: 8000)
    // Month 3: emergency gets 2000 (full at 10000), car gets 2000
    // Month 4: car gets 3000 (full at 5000), nothing left
    // Month 5: nothing to allocate (both full), surplus still flows

    const result = runProjection(plan, 5);

    // Month 1
    expect(result[0].funds['emergency']).toBe(4000);
    expect(result[0].funds['car']).toBe(0);

    // Month 2
    expect(result[1].funds['emergency']).toBe(8000);
    expect(result[1].funds['car']).toBe(0);

    // Month 3: emergency fills, overflow to car
    expect(result[2].funds['emergency']).toBe(10000);
    expect(result[2].funds['car']).toBe(2000);

    // Month 4: car gets remaining
    expect(result[3].funds['emergency']).toBe(10000);
    expect(result[3].funds['car']).toBe(5000);

    // Month 5: both full, no more allocation
    expect(result[4].funds['emergency']).toBe(10000);
    expect(result[4].funds['car']).toBe(5000);
  });

  it('should handle free-accumulating fund (target=0)', () => {
    const plan = createPlan({
      premises: { salary: 10000 },
      phases: [
        {
          id: 'p1',
          name: 'Phase 1',
          startMonth: 0,
          endMonth: 119,
          monthlyCost: 6000,
        },
      ],
      fundAllocation: [
        {
          fundId: 'emergency',
          label: 'Emergencia',
          target: 5000,
          priority: 1,
        },
        { fundId: 'free', label: 'Livre', target: 0, priority: 2 },
      ],
    });

    // Surplus = 4000/month
    // Month 1: emergency gets 4000
    // Month 2: emergency gets 1000 (full), free gets 3000
    // Month 3: free gets 4000 (total: 7000)

    const result = runProjection(plan, 3);

    expect(result[0].funds['emergency']).toBe(4000);
    expect(result[0].funds['free']).toBe(0);

    expect(result[1].funds['emergency']).toBe(5000);
    expect(result[1].funds['free']).toBe(3000);

    expect(result[2].funds['emergency']).toBe(5000);
    expect(result[2].funds['free']).toBe(7000);
  });

  it('should handle negative surplus (no allocation)', () => {
    const plan = createPlan({
      premises: { salary: 5000 },
      phases: [
        {
          id: 'p1',
          name: 'Phase 1',
          startMonth: 0,
          endMonth: 119,
          monthlyCost: 7000,
        },
      ],
      fundAllocation: [
        {
          fundId: 'emergency',
          label: 'Emergencia',
          target: 10000,
          priority: 1,
        },
      ],
    });

    const result = runProjection(plan, 3);

    // Surplus is -2000, no allocation should happen
    expect(result[0].surplus).toBe(-2000);
    expect(result[0].funds['emergency']).toBe(0);
    expect(result[1].funds['emergency']).toBe(0);
    expect(result[2].funds['emergency']).toBe(0);
  });

  it('should handle all funds full (surplus has nowhere to go)', () => {
    const plan = createPlan({
      premises: { salary: 10000 },
      phases: [
        {
          id: 'p1',
          name: 'Phase 1',
          startMonth: 0,
          endMonth: 119,
          monthlyCost: 6000,
        },
      ],
      fundAllocation: [
        { fundId: 'small', label: 'Pequeno', target: 2000, priority: 1 },
      ],
    });

    // Surplus = 4000, but fund only needs 2000
    // Month 1: small gets 2000 (full), 2000 unallocated
    // Month 2: small stays 2000, 4000 unallocated

    const result = runProjection(plan, 2);

    expect(result[0].funds['small']).toBe(2000);
    expect(result[1].funds['small']).toBe(2000);
  });

  it('should deduct monthly investment before waterfall', () => {
    const plan = createPlan({
      premises: { salary: 10000, monthlyInvestment: 800 },
      phases: [
        {
          id: 'p1',
          name: 'Phase 1',
          startMonth: 0,
          endMonth: 119,
          monthlyCost: 6000,
        },
      ],
      fundAllocation: [
        {
          fundId: 'emergency',
          label: 'Emergencia',
          target: 10000,
          priority: 1,
        },
      ],
    });

    // Surplus = 10000 - 6000 = 4000
    // Available after investment = 4000 - 800 = 3200
    // Emergency gets 3200

    const result = runProjection(plan, 1);

    expect(result[0].surplus).toBe(4000); // surplus is before investment deduction
    expect(result[0].funds['emergency']).toBe(3200);
  });

  it('should not allocate when investment exceeds surplus', () => {
    const plan = createPlan({
      premises: { salary: 10000, monthlyInvestment: 800 },
      phases: [
        {
          id: 'p1',
          name: 'Phase 1',
          startMonth: 0,
          endMonth: 119,
          monthlyCost: 9500,
        },
      ],
      fundAllocation: [
        {
          fundId: 'emergency',
          label: 'Emergencia',
          target: 10000,
          priority: 1,
        },
      ],
    });

    // Surplus = 500, investment = 800
    // Available = 500 - 800 = -300 (negative, no allocation)

    const result = runProjection(plan, 1);

    expect(result[0].surplus).toBe(500);
    expect(result[0].funds['emergency']).toBe(0);
  });

  it('should handle empty fund allocation', () => {
    const plan = createPlan({
      fundAllocation: [],
    });

    const result = runProjection(plan, 3);

    expect(result).toHaveLength(3);
    expect(result[0].surplus).toBe(4000);
    expect(Object.keys(result[0].funds)).toHaveLength(0);
  });

  it('should default to 120 months', () => {
    const plan = createPlan();
    const result = runProjection(plan);

    expect(result).toHaveLength(120);
  });

  it('should accumulate funds across months correctly', () => {
    const plan = createPlan({
      premises: { salary: 10000 },
      phases: [
        {
          id: 'p1',
          name: 'Phase 1',
          startMonth: 0,
          endMonth: 119,
          monthlyCost: 9000,
        },
      ],
      fundAllocation: [
        {
          fundId: 'emergency',
          label: 'Emergencia',
          target: 3000,
          priority: 1,
        },
        { fundId: 'free', label: 'Livre', target: 0, priority: 2 },
      ],
    });

    // Surplus = 1000/month
    // Months 1-3: emergency grows 1000/month to 3000
    // Month 4+: emergency stays 3000, free grows 1000/month

    const result = runProjection(plan, 6);

    expect(result[0].funds['emergency']).toBe(1000);
    expect(result[1].funds['emergency']).toBe(2000);
    expect(result[2].funds['emergency']).toBe(3000);
    expect(result[3].funds['emergency']).toBe(3000);

    expect(result[2].funds['free']).toBe(0);
    expect(result[3].funds['free']).toBe(1000);
    expect(result[4].funds['free']).toBe(2000);
    expect(result[5].funds['free']).toBe(3000);
  });

  it('should use different costs per phase', () => {
    const plan = createPlan({
      premises: { salary: 10000 },
      phases: [
        {
          id: 'cheap',
          name: 'Cheap',
          startMonth: 0,
          endMonth: 2,
          monthlyCost: 4000,
        },
        {
          id: 'expensive',
          name: 'Expensive',
          startMonth: 3,
          endMonth: 5,
          monthlyCost: 8000,
        },
      ],
    });

    const result = runProjection(plan, 6);

    expect(result[0].expenses).toBe(4000);
    expect(result[0].surplus).toBe(6000);
    expect(result[0].phase).toBe('cheap');
    expect(result[2].expenses).toBe(4000);
    expect(result[2].phase).toBe('cheap');

    expect(result[3].expenses).toBe(8000);
    expect(result[3].surplus).toBe(2000);
    expect(result[3].phase).toBe('expensive');
    expect(result[5].expenses).toBe(8000);
    expect(result[5].phase).toBe('expensive');
  });

  it('should have zero cost for months outside any phase', () => {
    const plan = createPlan({
      premises: { salary: 10000 },
      phases: [
        {
          id: 'only',
          name: 'Only Phase',
          startMonth: 0,
          endMonth: 2,
          monthlyCost: 5000,
        },
      ],
    });

    const result = runProjection(plan, 5);

    expect(result[0].expenses).toBe(5000);
    expect(result[2].expenses).toBe(5000);
    expect(result[3].expenses).toBe(0);
    expect(result[3].surplus).toBe(10000);
    expect(result[3].phase).toBe('');
  });

  it('should include phase id in MonthData', () => {
    const plan = createPlan({
      premises: { salary: 10000 },
      phases: [
        {
          id: 'phase-a',
          name: 'A',
          startMonth: 0,
          endMonth: 1,
          monthlyCost: 3000,
        },
        {
          id: 'phase-b',
          name: 'B',
          startMonth: 2,
          endMonth: 3,
          monthlyCost: 7000,
        },
      ],
    });

    const result = runProjection(plan, 4);

    expect(result[0].phase).toBe('phase-a');
    expect(result[1].phase).toBe('phase-a');
    expect(result[2].phase).toBe('phase-b');
    expect(result[3].phase).toBe('phase-b');
  });
});
