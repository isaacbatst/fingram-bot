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
        scheduledMovements: [],
      },
    ],
    ...overrides,
  });
}

describe('runProjection', () => {
  it('should use initialBalance as starting point for calculations', () => {
    const plan = createPlan({
      boxes: [
        {
          id: 'reserva',
          label: 'Reserva',
          target: 10000,
          monthlyAmount: [{ month: 0, amount: 4000 }],
          holdsFunds: true,
          initialBalance: 2500,
          scheduledMovements: [],
        },
      ],
    });
    const result = runProjection(plan, 1);

    // Month 0: 2500 initial + 4000 deposit = 6500
    expect(result[0].boxes['reserva']).toBe(6500);
  });

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

    expect(result[0].month).toBe(0);
    expect(result[0].date.getUTCMonth()).toBe(2); // March
    expect(result[1].month).toBe(1);
    expect(result[1].date.getUTCMonth()).toBe(3); // April
    expect(result[2].month).toBe(2);
    expect(result[2].date.getUTCMonth()).toBe(4); // May
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
          scheduledMovements: [],
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
          scheduledMovements: [{ month: 2, amount: 10000, label: 'Entrada', type: 'in' }],
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
          scheduledMovements: [
            { month: 1, amount: 10000, label: 'Entrada 1/4', type: 'in' },
          ],
        },
      ],
    });
    const result = runProjection(plan, 3);

    expect(result[0].boxPayments['terreno']).toBe(2000);
    expect(result[1].boxPayments['terreno']).toBe(10000);
    expect(result[1].scheduledMovements).toEqual([
      { boxId: 'terreno', amount: 10000, label: 'Entrada 1/4', type: 'in' },
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
          scheduledMovements: [
            {
              month: 1,
              amount: 10000,
              label: 'Extra',
              type: 'in',
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
          scheduledMovements: [
            { month: 2, amount: 5000, label: 'Part A', type: 'in' },
            { month: 2, amount: 3000, label: 'Part B', type: 'in' },
          ],
        },
      ],
    });
    const result = runProjection(plan, 3);

    expect(result[2].boxPayments['terreno']).toBe(8000);
    expect(result[2].scheduledMovements).toHaveLength(2);
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
          scheduledMovements: [
            { month: 3, amount: 10000, label: 'Big payment', type: 'in' },
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
          scheduledMovements: [{ month: 3, amount: 5000, label: 'Lump sum', type: 'in' }],
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
    expect(result[3].scheduledMovements).toEqual([
      { boxId: 'box', amount: 5000, label: 'Lump sum', type: 'in' },
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
          scheduledMovements: [],
        },
        {
          id: 'terreno',
          label: 'Terreno',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 2000 }],
          holdsFunds: false,
          scheduledMovements: [],
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
          scheduledMovements: [],
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
          scheduledMovements: [],
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
          scheduledMovements: [
            { month: 0, amount: 10000, label: 'Entrada 1/4', type: 'in' },
            { month: 1, amount: 10000, label: 'Entrada 2/4', type: 'in' },
            { month: 2, amount: 10000, label: 'Entrada 3/4', type: 'in' },
            { month: 3, amount: 23000, label: 'Entrada 4/4', type: 'in' },
          ],
        },
        {
          id: 'acoes',
          label: 'Acoes',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 800 }],
          holdsFunds: true,
          scheduledMovements: [],
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

  describe('yield', () => {
    it('should apply monthly yield to holdsFunds box', () => {
      const plan = createPlan({
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
        },
        boxes: [
          {
            id: 'reserva',
            label: 'Reserva',
            target: 0,
            monthlyAmount: [{ month: 0, amount: 1000 }],
            holdsFunds: true,
            yieldRate: 0.12,
            scheduledMovements: [],
          },
        ],
      });
      const result = runProjection(plan, 1);

      const expectedYield = 1000 * (0.12 / 12);
      expect(result[0].boxYields['reserva']).toBeCloseTo(expectedYield);
      expect(result[0].boxes['reserva']).toBeCloseTo(1000 + expectedYield);
    });

    it('should compound yield over multiple months', () => {
      const plan = createPlan({
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
        },
        boxes: [
          {
            id: 'reserva',
            label: 'Reserva',
            target: 0,
            monthlyAmount: [{ month: 0, amount: 1000 }],
            holdsFunds: true,
            yieldRate: 0.12,
            scheduledMovements: [],
          },
        ],
      });
      const result = runProjection(plan, 2);

      // Month 0: deposit 1000, yield = 1000 * 0.01 = 10, balance = 1010
      // Month 1: deposit 1000, balance before yield = 2010, yield = 2010 * 0.01 = 20.10
      expect(result[1].boxYields['reserva']).toBeCloseTo(2010 * 0.01);
      expect(result[1].boxes['reserva']).toBeCloseTo(2010 + 2010 * 0.01);
    });

    it('should continue yielding after target is reached', () => {
      const plan = createPlan({
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
        },
        boxes: [
          {
            id: 'reserva',
            label: 'Reserva',
            target: 2000,
            monthlyAmount: [{ month: 0, amount: 1000 }],
            holdsFunds: true,
            yieldRate: 0.12,
            scheduledMovements: [],
          },
        ],
      });
      const result = runProjection(plan, 4);

      // Month 1: balance reaches 2000 (capped), yield makes it > 2000
      // Month 2: no outflow (target reached), but yield still applies
      expect(result[2].boxPayments['reserva']).toBe(0);
      expect(result[2].boxYields['reserva']).toBeGreaterThan(0);
      expect(result[2].boxes['reserva']).toBeGreaterThan(2000);
    });

    it('should not yield on holdsFunds: false box', () => {
      const plan = createPlan({
        boxes: [
          {
            id: 'terreno',
            label: 'Terreno',
            target: 0,
            monthlyAmount: [{ month: 0, amount: 2000 }],
            holdsFunds: false,
            yieldRate: 0.12,
            scheduledMovements: [],
          },
        ],
      });
      const result = runProjection(plan, 2);

      expect(result[0].boxYields['terreno']).toBe(0);
      expect(result[1].boxYields['terreno']).toBe(0);
      expect(result[1].boxes['terreno']).toBe(4000);
    });

    it('should not yield when yieldRate is undefined', () => {
      const plan = createPlan();
      const result = runProjection(plan, 1);

      expect(result[0].boxYields['reserva']).toBe(0);
    });

    it('should not yield when yieldRate is 0', () => {
      const plan = createPlan({
        boxes: [
          {
            id: 'reserva',
            label: 'Reserva',
            target: 0,
            monthlyAmount: [{ month: 0, amount: 1000 }],
            holdsFunds: true,
            yieldRate: 0,
            scheduledMovements: [],
          },
        ],
      });
      const result = runProjection(plan, 1);

      expect(result[0].boxYields['reserva']).toBe(0);
      expect(result[0].boxes['reserva']).toBe(1000);
    });

    it('should aggregate totalYield across all boxes', () => {
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
            yieldRate: 0.12,
            scheduledMovements: [],
          },
          {
            id: 'acoes',
            label: 'Acoes',
            target: 0,
            monthlyAmount: [{ month: 0, amount: 2000 }],
            holdsFunds: true,
            yieldRate: 0.06,
            scheduledMovements: [],
          },
        ],
      });
      const result = runProjection(plan, 1);

      const expectedTotal =
        result[0].boxYields['reserva'] + result[0].boxYields['acoes'];
      expect(result[0].totalYield).toBeCloseTo(expectedTotal);
    });

    it('should include yield in totalWealth', () => {
      const plan = createPlan({
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [{ month: 0, amount: 9000 }],
        },
        boxes: [
          {
            id: 'reserva',
            label: 'Reserva',
            target: 0,
            monthlyAmount: [{ month: 0, amount: 1000 }],
            holdsFunds: true,
            yieldRate: 0.12,
            scheduledMovements: [],
          },
        ],
      });
      const result = runProjection(plan, 1);

      const expectedYield = 1000 * (0.12 / 12);
      // totalWealth = cash + box balance (which includes yield)
      expect(result[0].totalWealth).toBeCloseTo(0 + 1000 + expectedYield);
    });
  });

  describe('financing', () => {
    it('should calculate SAC payments with declining installments', () => {
      // SAC (Sistema de Amortizacao Constante) R$120.000 a 12% a.a. (1% a.m.) em 12 meses.
      //
      // Amortizacao constante = principal / n = 120.000 / 12 = R$10.000/mes
      // Juros = saldo_devedor * taxa_mensal (cai a cada mes conforme saldo diminui)
      //
      //   Mes 0:  saldo=120k, juros=120k*0.01=R$1.200, prestacao=10k+1.200=R$11.200
      //   Mes 1:  saldo=110k, juros=110k*0.01=R$1.100, prestacao=10k+1.100=R$11.100
      //   ...
      //   Mes 11: saldo=10k,  juros=10k*0.01=R$100,    prestacao=10k+100=R$10.100
      //
      // Apos 12 meses: saldo = 120k - 12*10k = R$0
      const plan = createPlan({
        boxes: [
          {
            id: 'fin',
            label: 'Casa',
            target: 0,
            monthlyAmount: [],
            holdsFunds: false,
            scheduledMovements: [],
            financing: {
              principal: 120_000,
              annualRate: 0.12,
              termMonths: 12,
              system: 'sac',
            },
          },
        ],
      });

      const result = runProjection(plan, 12);
      const rate = 0.12 / 12;

      expect(result[0].financingDetails['fin'].amortization).toBeCloseTo(
        10_000,
        0,
      );
      expect(result[0].financingDetails['fin'].interest).toBeCloseTo(
        120_000 * rate,
        2,
      );
      expect(result[0].financingDetails['fin'].phase).toBe('amortization');

      // Last payment < first payment (SAC declining property)
      expect(result[11].financingDetails['fin'].payment).toBeLessThan(
        result[0].financingDetails['fin'].payment,
      );

      // After 12 months of 10k amortization each: outstanding = 0
      expect(result[11].financingDetails['fin'].outstandingBalance).toBeCloseTo(
        0,
        2,
      );
    });

    it('should calculate PRICE payments with constant installments', () => {
      // PRICE (Tabela Price) R$60.000 a 18% a.a. (1.5% a.m.) em 24 meses.
      //
      // Formula: PMT = P * [r * (1+r)^n] / [(1+r)^n - 1]
      //   r = 0.18/12 = 0.015
      //   (1.015)^24 = ~1.4295
      //   PMT = 60.000 * [0.015 * 1.4295] / [0.4295]
      //       = 60.000 * 0.02144 / 0.4295
      //       = 60.000 * 0.04993
      //       = ~R$2.996/mes (constante para todas as 24 parcelas)
      //
      // Internamente a cada mes:
      //   juros = saldo * 0.015 (cai)
      //   amortizacao = PMT - juros (cresce)
      //   Mas o total (PMT) permanece fixo.
      //
      // Ao final de 24 meses: saldo = R$0
      const plan = createPlan({
        boxes: [
          {
            id: 'car',
            label: 'Carro',
            target: 0,
            monthlyAmount: [],
            holdsFunds: false,
            scheduledMovements: [],
            financing: {
              principal: 60_000,
              annualRate: 0.18,
              termMonths: 24,
              system: 'price',
            },
          },
        ],
      });

      const result = runProjection(plan, 24);

      const firstPayment = result[0].financingDetails['car'].payment;
      for (let i = 1; i < 24; i++) {
        expect(result[i].financingDetails['car'].payment).toBeCloseTo(
          firstPayment,
          2,
        );
      }

      expect(result[23].financingDetails['car'].outstandingBalance).toBeCloseTo(
        0,
        2,
      );
    });

    it('should handle construction phase with growing interest', () => {
      // R$1.200.000 a 11% a.a. (0.917% a.m.), SAC com 420 meses, 16 meses de obra.
      //
      // Juros de obra: banco libera 95% do principal linearmente.
      //   liberado_por_mes = (1.200.000 * 0.95) / 16 = R$71.250
      //   acumulado(m) = 71.250 * (m+1)
      //   juros(m) = acumulado(m) * 0.0091667
      //
      // Exemplos:
      //   Mes 0:  acum=71.250,    juros=71.250*0.00917=R$653      (amort=R$0)
      //   Mes 7:  acum=570.000,   juros=570k*0.00917=R$5.225      (amort=R$0)
      //   Mes 15: acum=1.140.000, juros=1.140k*0.00917=R$10.450   (amort=R$0)
      //
      // Mes 16: obra termina, SAC comeca sobre saldo total R$1.200.000.
      //   amort = 1.200.000 / 420 = R$2.857,14
      //   juros = 1.200.000 * 0.00917 = R$11.000
      //   prestacao = R$13.857
      const plan = createPlan({
        premises: {
          salaryChangePoints: [{ month: 0, amount: 50_000 }],
          costOfLivingChangePoints: [{ month: 0, amount: 20_000 }],
        },
        boxes: [
          {
            id: 'obra',
            label: 'Financiamento Obra',
            target: 0,
            monthlyAmount: [],
            holdsFunds: false,
            scheduledMovements: [],
            financing: {
              principal: 1_200_000,
              annualRate: 0.11,
              termMonths: 420,
              system: 'sac',
              constructionMonths: 16,
            },
          },
        ],
      });

      const result = runProjection(plan, 18);

      for (let i = 0; i < 16; i++) {
        expect(result[i].financingDetails['obra'].phase).toBe('construction');
        expect(result[i].financingDetails['obra'].amortization).toBe(0);
      }

      // Interest grows linearly with released amount
      expect(result[15].financingDetails['obra'].interest).toBeGreaterThan(
        result[0].financingDetails['obra'].interest,
      );

      // Month 16: amortization starts. SAC amort = 1.2M / 420 = ~2,857.
      expect(result[16].financingDetails['obra'].phase).toBe('amortization');
      expect(result[16].financingDetails['obra'].amortization).toBeGreaterThan(
        0,
      );
    });

    it('should deduct financing payments from cash (affects surplus)', () => {
      // SAC R$12.000 a 12% a.a. (1% a.m.) em 12 meses.
      //
      // Mes 0:
      //   amort = 12.000 / 12 = R$1.000
      //   juros = 12.000 * 0.01 = R$120
      //   prestacao = 1.000 + 120 = R$1.120
      //
      // Fluxo mensal (premissas do createPlan: salario=10k, custo=6k):
      //   surplus = salario - custo_de_vida - prestacao
      //           = 10.000 - 6.000 - 1.120 = R$2.880
      const plan = createPlan({
        boxes: [
          {
            id: 'fin',
            label: 'Casa',
            target: 0,
            monthlyAmount: [],
            holdsFunds: false,
            scheduledMovements: [],
            financing: {
              principal: 12_000,
              annualRate: 0.12,
              termMonths: 12,
              system: 'sac',
            },
          },
        ],
      });

      const result = runProjection(plan, 1);
      const payment = result[0].financingDetails['fin'].payment;

      expect(result[0].surplus).toBeCloseTo(10_000 - 6_000 - payment, 2);
    });

    it('should track balance as amortization progress (not total paid)', () => {
      // SAC R$120.000 a 12% a.a. (1% a.m.) em 12 meses.
      //
      // Mes 0:
      //   amort = R$10.000, juros = R$1.200, prestacao = R$11.200
      //   R$11.200 sai do caixa (boxOutflows), mas apenas R$10.000 vira "progresso".
      //
      // Box balance (boxes['fin']) = principal - outstanding = 120k - 110k = R$10.000
      //   Isso reflete amortizacao acumulada, NAO total pago.
      //   Juros sao custo puro, nao constroem patrimonio.
      //
      // totalCommitted = soma dos balances de boxes holdsFunds:false = R$10.000
      const plan = createPlan({
        boxes: [
          {
            id: 'fin',
            label: 'Casa',
            target: 0,
            monthlyAmount: [],
            holdsFunds: false,
            scheduledMovements: [],
            financing: {
              principal: 120_000,
              annualRate: 0.12,
              termMonths: 12,
              system: 'sac',
            },
          },
        ],
      });

      const result = runProjection(plan, 1);

      expect(result[0].boxes['fin']).toBeCloseTo(10_000, 0);
      expect(result[0].totalCommitted).toBeCloseTo(10_000, 0);
    });

    it('should handle extra amortization from cash', () => {
      // SAC R$120.000 a 12% a.a. (1% a.m.) em 12 meses.
      // scheduledPayment de R$50.000 no mes 1 (sem sourceBoxId => sai do caixa).
      //
      // Mes 0 (normal):
      //   amort = 120.000/12 = R$10.000
      //   juros = 120.000*0.01 = R$1.200
      //   saldo apos = R$110.000
      //
      // Mes 1 (extra de R$50.000):
      //   Extra aplicado antes: saldo = 110.000 - 50.000 = R$60.000
      //   SAC recalculado: amort = 60.000/11 = R$5.454,55
      //   juros = 60.000*0.01 = R$600
      //   saldo apos = 60.000 - 5.454 = R$54.545,45
      //   boxOutflows = 50.000 (extra) + 6.054 (prestacao) = R$56.054
      //
      // Mes 2: SAC sobre R$54.545 com 10 parcelas restantes
      //   amort = 54.545/10 = R$5.454, juros = 545 => prestacao ~R$6.000
      //   Muito menor que mes 0 (R$11.200)
      const plan = createPlan({
        boxes: [
          {
            id: 'fin',
            label: 'Casa',
            target: 0,
            monthlyAmount: [],
            holdsFunds: false,
            scheduledMovements: [
              { month: 1, amount: 50_000, label: 'Amortizacao extra', type: 'in' },
            ],
            financing: {
              principal: 120_000,
              annualRate: 0.12,
              termMonths: 12,
              system: 'sac',
            },
          },
        ],
      });

      const result = runProjection(plan, 3);

      expect(result[0].financingDetails['fin'].outstandingBalance).toBeCloseTo(
        110_000,
        0,
      );

      // After extra amort of 50k + regular amort: outstanding < 60k
      expect(result[1].financingDetails['fin'].outstandingBalance).toBeLessThan(
        60_000,
      );

      // Lower outstanding => lower interest => lower total payment
      expect(result[2].financingDetails['fin'].payment).toBeLessThan(
        result[0].financingDetails['fin'].payment,
      );
    });

    it('should handle extra amortization from source box', () => {
      // type: 'out' com destinationBoxId: transferencia direta box-a-box, sem passar pelo caixa.
      //
      // Reserva deposita R$5.000/mes. No mes 2 (antes do deposito do mes):
      //   saldo reserva = 5k(m0) + 5k(m1) = R$10.000
      //   + deposito do mes 2: R$15.000
      //   - transferencia de R$10.000 (type: 'out') => reserva = R$5.000
      //
      // Efeito no financiamento: extra amort de R$10.000 aplicado ao saldo devedor.
      // Efeito no caixa: NENHUM. A transferencia e direta (box -> financing).
      //   Caixa do mes 2 = caixa_mes1 + surplus_mes2 (sem descontar a transferencia)
      const plan = createPlan({
        boxes: [
          {
            id: 'reserva',
            label: 'Reserva',
            target: 0,
            monthlyAmount: [{ month: 0, amount: 5000 }],
            holdsFunds: true,
            scheduledMovements: [
              {
                month: 2,
                amount: 10_000,
                label: 'Entrada da reserva',
                type: 'out',
                destinationBoxId: 'fin',
              },
            ],
          },
          {
            id: 'fin',
            label: 'Casa',
            target: 0,
            monthlyAmount: [],
            holdsFunds: false,
            scheduledMovements: [],
            financing: {
              principal: 120_000,
              annualRate: 0.12,
              termMonths: 12,
              system: 'sac',
            },
          },
        ],
      });

      const result = runProjection(plan, 4);

      // Month 0-1: reserva = 5k + 5k = 10k
      expect(result[1].boxes['reserva']).toBeCloseTo(10_000, 0);

      // Month 2: reserva = 15k - 10k(transfer) = 5k
      expect(result[2].boxes['reserva']).toBeCloseTo(5_000, 0);
      // Cash unaffected by sourceBoxId transfer (no cash outflow for this)
      const cashWithoutTransfer = result[1].cash + result[2].surplus;
      expect(result[2].cash).toBeCloseTo(cashWithoutTransfer, 0);
    });

    it('should produce same result regardless of box order when using out movements to financing', () => {
      // Testa independencia de ordem do motor de 2 passes.
      //
      // Setup: reserva deposita R$5.000/mes. No mes 1, movimento type: 'out' de R$8.000
      // na reserva com destinationBoxId='fin'.
      //
      // Estado no mes 1:
      //   Reserva pre-deposito = R$5.000 (do mes 0)
      //   Reserva pos-deposito = R$10.000 (apos deposito do mes 1)
      //
      // Com motor de 2 passes:
      //   Passo 1: processa todas as boxes regulares (depositos + out movements)
      //   Passo 2: processa todas as boxes de financiamento (extra amortizations acumuladas)
      //   Ambas as ordens: reserva = 10k apos deposito, deducao = 8k => reserva = 2k
      const reserva = {
        id: 'reserva',
        label: 'Reserva',
        target: 0,
        monthlyAmount: [{ month: 0, amount: 5000 }],
        holdsFunds: true,
        scheduledMovements: [
          {
            month: 1,
            amount: 8_000,
            label: 'Entrada',
            type: 'out' as const,
            destinationBoxId: 'fin',
          },
        ],
      };

      const fin = {
        id: 'fin',
        label: 'Casa',
        target: 0,
        monthlyAmount: [],
        holdsFunds: false,
        scheduledMovements: [],
        financing: {
          principal: 120_000,
          annualRate: 0.12,
          termMonths: 12,
          system: 'sac' as const,
        },
      };

      const planA = createPlan({ boxes: [reserva, fin] });
      const planB = createPlan({ boxes: [fin, reserva] });

      const resultA = runProjection(planA, 3);
      const resultB = runProjection(planB, 3);

      // Both orderings should produce identical results at month 1
      expect(resultA[1].boxes['reserva']).toBeCloseTo(
        resultB[1].boxes['reserva'],
        2,
      );
      expect(resultA[1].financingDetails['fin'].outstandingBalance).toBeCloseTo(
        resultB[1].financingDetails['fin'].outstandingBalance,
        2,
      );
      expect(resultA[1].cash).toBeCloseTo(resultB[1].cash, 2);
    });

    it('should include financing box in totalCommitted, not totalWealth', () => {
      // Semantica de totalWealth vs totalCommitted:
      //   totalWealth = caixa + soma(boxes com holdsFunds:true)
      //   totalCommitted = soma(boxes com holdsFunds:false)
      //
      // SAC R$12.000 a 12% a.a. em 12 meses (financing box, holdsFunds:false).
      //   Mes 0: amort = 12.000/12 = R$1.000
      //   balance = principal - outstanding = 12k - 11k = R$1.000
      //
      // totalCommitted = R$1.000 (progresso da amortizacao)
      // totalWealth = caixa apenas (nao ha boxes holdsFunds:true neste plano)
      //   caixa = salario(10k) - custo(6k) - prestacao(1.120) = R$2.880
      const plan = createPlan({
        boxes: [
          {
            id: 'fin',
            label: 'Casa',
            target: 0,
            monthlyAmount: [],
            holdsFunds: false,
            scheduledMovements: [],
            financing: {
              principal: 12_000,
              annualRate: 0.12,
              termMonths: 12,
              system: 'sac',
            },
          },
        ],
      });

      const result = runProjection(plan, 1);

      expect(result[0].totalCommitted).toBeCloseTo(1_000, 0);
      expect(result[0].totalWealth).toBeCloseTo(result[0].cash, 0);
    });
  });
});
