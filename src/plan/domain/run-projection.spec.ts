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
    premises: {
      salaryChangePoints: [{ month: 0, amount: 10000 }],
      costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
    },
    boxes: [
      {
        id: 'reserva',
        label: 'Reserva',
        target: 10000,
        monthlyAmount: [{ month: 0, amount: 4000 }],
        holdsFunds: true,
        scheduledPayments: [],
      },
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
    expect(result[0].costOfLiving).toBe(6000);
    expect(result[0].surplus).toBe(0);
    expect(result[0].cash).toBe(0);
    expect(result[0].boxes['reserva']).toBe(4000);
  });

  it('should return correct month numbers and dates', () => {
    const plan = createPlan({
      startDate: new Date(2026, 2, 1),
    });
    const result = runProjection(plan, 3);

    expect(result[0].month).toBe(1);
    expect(result[0].date.getMonth()).toBe(2);
    expect(result[1].month).toBe(2);
    expect(result[1].date.getMonth()).toBe(3);
    expect(result[2].month).toBe(3);
    expect(result[2].date.getMonth()).toBe(4);
  });

  it('should handle salary change points', () => {
    const plan = createPlan({
      premises: {
        salaryChangePoints: [
          { month: 0, amount: 10000 },
          { month: 3, amount: 15000 },
        ],
        costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
      },
      boxes: [],
    });
    const result = runProjection(plan, 5);

    expect(result[0].income).toBe(10000);
    expect(result[2].income).toBe(10000);
    expect(result[3].income).toBe(15000);
    expect(result[4].income).toBe(15000);
  });

  it('should handle cost of living change points', () => {
    const plan = createPlan({
      premises: {
        salaryChangePoints: [{ month: 0, amount: 10000 }],
        costOfLivingChangePoints: [
          { month: 0, amount: 6000 },
          { month: 2, amount: 5000 },
        ],
      },
      boxes: [],
    });
    const result = runProjection(plan, 4);

    expect(result[0].costOfLiving).toBe(6000);
    expect(result[1].costOfLiving).toBe(6000);
    expect(result[2].costOfLiving).toBe(5000);
    expect(result[3].costOfLiving).toBe(5000);
  });

  it('should stop box when target is reached', () => {
    const plan = createPlan({
      premises: {
        salaryChangePoints: [{ month: 0, amount: 10000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
      },
      boxes: [
        {
          id: 'reserva',
          label: 'Reserva',
          target: 5000,
          monthlyAmount: [{ month: 0, amount: 4000 }],
          holdsFunds: true,
          scheduledPayments: [],
        },
      ],
    });
    const result = runProjection(plan, 3);

    expect(result[0].boxes['reserva']).toBe(4000);
    expect(result[0].boxPayments['reserva']).toBe(4000);
    expect(result[1].boxes['reserva']).toBe(5000);
    expect(result[1].boxPayments['reserva']).toBe(1000);
    expect(result[2].boxes['reserva']).toBe(5000);
    expect(result[2].boxPayments['reserva']).toBe(0);
    expect(result[2].cash).toBeGreaterThan(0);
  });

  it('should handle box with no monthly amount (only scheduled payments)', () => {
    const plan = createPlan({
      boxes: [
        {
          id: 'pontual',
          label: 'Pontual',
          target: 50000,
          monthlyAmount: [],
          holdsFunds: false,
          scheduledPayments: [{ month: 2, amount: 10000, label: 'Entrada' }],
        },
      ],
    });
    const result = runProjection(plan, 4);

    expect(result[0].boxPayments['pontual']).toBe(0);
    expect(result[1].boxPayments['pontual']).toBe(0);
    expect(result[2].boxPayments['pontual']).toBe(10000);
    expect(result[2].boxes['pontual']).toBe(10000);
    expect(result[3].boxPayments['pontual']).toBe(0);
  });

  it('should replace monthly with scheduled payment by default', () => {
    const plan = createPlan({
      boxes: [
        {
          id: 'terreno',
          label: 'Terreno',
          target: 100000,
          monthlyAmount: [{ month: 0, amount: 2000 }],
          holdsFunds: false,
          scheduledPayments: [
            { month: 1, amount: 10000, label: 'Entrada 1/4' },
          ],
        },
      ],
    });
    const result = runProjection(plan, 3);

    expect(result[0].boxPayments['terreno']).toBe(2000);
    expect(result[1].boxPayments['terreno']).toBe(10000);
    expect(result[1].scheduledPayments).toEqual([
      { boxId: 'terreno', amount: 10000, label: 'Entrada 1/4' },
    ]);
    expect(result[2].boxPayments['terreno']).toBe(2000);
  });

  it('should add monthly when additionalToMonthly is true', () => {
    const plan = createPlan({
      boxes: [
        {
          id: 'terreno',
          label: 'Terreno',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 2000 }],
          holdsFunds: false,
          scheduledPayments: [
            {
              month: 1,
              amount: 10000,
              label: 'Extra',
              additionalToMonthly: true,
            },
          ],
        },
      ],
    });
    const result = runProjection(plan, 2);

    expect(result[1].boxPayments['terreno']).toBe(12000);
  });

  it('should sum multiple scheduled payments in same month same box', () => {
    const plan = createPlan({
      boxes: [
        {
          id: 'terreno',
          label: 'Terreno',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          holdsFunds: false,
          scheduledPayments: [
            { month: 2, amount: 5000, label: 'Part A' },
            { month: 2, amount: 3000, label: 'Part B' },
          ],
        },
      ],
    });
    const result = runProjection(plan, 3);

    expect(result[2].boxPayments['terreno']).toBe(8000);
    expect(result[2].scheduledPayments).toHaveLength(2);
  });

  it('should NOT cap scheduled payments at target', () => {
    const plan = createPlan({
      boxes: [
        {
          id: 'box',
          label: 'Box',
          target: 5000,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          holdsFunds: true,
          scheduledPayments: [
            { month: 3, amount: 10000, label: 'Big payment' },
          ],
        },
      ],
    });
    const result = runProjection(plan, 5);

    expect(result[2].boxes['box']).toBe(3000);
    expect(result[3].boxes['box']).toBe(13000);
    expect(result[3].boxPayments['box']).toBe(10000);
    expect(result[4].boxPayments['box']).toBe(0);
  });

  it('should execute scheduled payments even after target is reached', () => {
    const plan = createPlan({
      boxes: [
        {
          id: 'box',
          label: 'Box',
          target: 2000,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          holdsFunds: false,
          scheduledPayments: [{ month: 3, amount: 5000, label: 'Lump sum' }],
        },
      ],
    });
    const result = runProjection(plan, 5);

    // Month 0: +1000 (balance 1000)
    // Month 1: +1000 (balance 2000 = target reached)
    // Month 2: target reached, no monthly (balance 2000)
    // Month 3: scheduled payment fires despite target reached (balance 7000)
    // Month 4: target reached, no monthly (balance 7000)
    expect(result[1].boxes['box']).toBe(2000);
    expect(result[2].boxPayments['box']).toBe(0);
    expect(result[3].boxPayments['box']).toBe(5000);
    expect(result[3].boxes['box']).toBe(7000);
    expect(result[3].scheduledPayments).toEqual([
      { boxId: 'box', amount: 5000, label: 'Lump sum' },
    ]);
    expect(result[4].boxPayments['box']).toBe(0);
  });

  it('should handle negative surplus (cash goes negative)', () => {
    const plan = createPlan({
      premises: {
        salaryChangePoints: [{ month: 0, amount: 5000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 7000 }],
      },
      boxes: [],
    });
    const result = runProjection(plan, 3);

    expect(result[0].surplus).toBe(-2000);
    expect(result[0].cash).toBe(-2000);
    expect(result[1].cash).toBe(-4000);
    expect(result[2].cash).toBe(-6000);
  });

  it('should compute totalWealth and totalCommitted correctly', () => {
    const plan = createPlan({
      premises: {
        salaryChangePoints: [{ month: 0, amount: 20000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 10000 }],
      },
      boxes: [
        {
          id: 'reserva',
          label: 'Reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 3000 }],
          holdsFunds: true,
          scheduledPayments: [],
        },
        {
          id: 'terreno',
          label: 'Terreno',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 2000 }],
          holdsFunds: false,
          scheduledPayments: [],
        },
      ],
    });
    const result = runProjection(plan, 1);

    expect(result[0].surplus).toBe(5000);
    expect(result[0].cash).toBe(5000);
    expect(result[0].totalWealth).toBe(8000);
    expect(result[0].totalCommitted).toBe(2000);
  });

  it('should default to 120 months when no explicit months given', () => {
    const plan = createPlan({ boxes: [] });
    const result = runProjection(plan);
    expect(result).toHaveLength(120);
  });

  it('should handle change point without month 0 (uses fallback 0)', () => {
    const plan = createPlan({
      premises: {
        salaryChangePoints: [{ month: 5, amount: 10000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 0 }],
      },
      boxes: [],
    });
    const result = runProjection(plan, 7);

    expect(result[0].income).toBe(0);
    expect(result[4].income).toBe(0);
    expect(result[5].income).toBe(10000);
    expect(result[6].income).toBe(10000);
  });

  it('should handle box monthlyAmount change points', () => {
    const plan = createPlan({
      premises: {
        salaryChangePoints: [{ month: 0, amount: 20000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 5000 }],
      },
      boxes: [
        {
          id: 'terreno',
          label: 'Terreno',
          target: 0,
          monthlyAmount: [
            { month: 0, amount: 1893 },
            { month: 10, amount: 2741 },
          ],
          holdsFunds: false,
          scheduledPayments: [],
        },
      ],
    });
    const result = runProjection(plan, 12);

    expect(result[0].boxPayments['terreno']).toBe(1893);
    expect(result[9].boxPayments['terreno']).toBe(1893);
    expect(result[10].boxPayments['terreno']).toBe(2741);
    expect(result[11].boxPayments['terreno']).toBe(2741);
  });

  it('should handle empty boxes', () => {
    const plan = createPlan({ boxes: [] });
    const result = runProjection(plan, 3);

    expect(result).toHaveLength(3);
    expect(result[0].surplus).toBe(4000);
    expect(result[0].cash).toBe(4000);
    expect(Object.keys(result[0].boxes)).toHaveLength(0);
  });

  it('should handle boxes deducting unconditionally even when cash is negative', () => {
    const plan = createPlan({
      premises: {
        salaryChangePoints: [{ month: 0, amount: 10000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 9500 }],
      },
      boxes: [
        {
          id: 'acoes',
          label: 'Acoes',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 800 }],
          holdsFunds: true,
          scheduledPayments: [],
        },
      ],
    });
    const result = runProjection(plan, 1);

    expect(result[0].surplus).toBe(-300);
    expect(result[0].cash).toBe(-300);
    expect(result[0].boxes['acoes']).toBe(800);
  });

  it('should project real plan.md scenario (4 down payments)', () => {
    const plan = createPlan({
      premises: {
        salaryChangePoints: [{ month: 0, amount: 33000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 18000 }],
      },
      boxes: [
        {
          id: 'terreno',
          label: 'Parcela terreno',
          target: 530000,
          monthlyAmount: [{ month: 0, amount: 1893 }],
          holdsFunds: false,
          scheduledPayments: [
            { month: 0, amount: 10000, label: 'Entrada 1/4' },
            { month: 1, amount: 10000, label: 'Entrada 2/4' },
            { month: 2, amount: 10000, label: 'Entrada 3/4' },
            { month: 3, amount: 23000, label: 'Entrada 4/4' },
          ],
        },
        {
          id: 'acoes',
          label: 'Acoes',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 800 }],
          holdsFunds: true,
          scheduledPayments: [],
        },
      ],
    });
    const result = runProjection(plan, 6);

    expect(result[0].income).toBe(33000);
    expect(result[0].boxPayments['terreno']).toBe(10000);
    expect(result[0].boxPayments['acoes']).toBe(800);
    expect(result[0].surplus).toBe(4200);

    expect(result[3].boxPayments['terreno']).toBe(23000);
    expect(result[3].surplus).toBe(-8800);
    expect(result[3].cash).toBe(3800);

    expect(result[4].boxPayments['terreno']).toBe(1893);
    expect(result[4].surplus).toBe(33000 - 18000 - 1893 - 800);
  });
});
