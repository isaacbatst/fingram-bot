import { describe, it, expect } from 'vitest';
import { Allocation } from '../shared/domain/allocation';
import { Premises, RealMonthData } from './plan';
import { runProjection } from './run-projection';

const defaultPremises: Premises = {
  salaryChangePoints: [{ month: 0, amount: 10000 }],
  costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
};

const defaultStartDate = new Date('2026-01-01');

function makeAllocation(
  overrides: Partial<{
    id: string;
    label: string;
    target: number;
    monthlyAmount: { month: number; amount: number }[];
    realizationMode: 'immediate' | 'manual' | 'onCompletion';
    yieldRate: number;
    financing: {
      principal: number;
      annualRate: number;
      termMonths: number;
      system: 'sac' | 'price';
      constructionMonths?: number;
      gracePeriodMonths?: number;
      releasePercent?: number;
      startMonth?: number;
    };
    scheduledMovements: {
      month: number;
      amount: number;
      label: string;
      type: 'in' | 'out';
      destinationBoxId?: string;
      additionalToMonthly?: boolean;
    }[];
    initialBalance: number;
  }> = {},
): Allocation {
  return Allocation.restore({
    id: overrides.id ?? 'reserva',
    planId: 'plan-1',
    label: overrides.label ?? 'Reserva',
    target: overrides.target ?? 10000,
    monthlyAmount: overrides.monthlyAmount ?? [{ month: 0, amount: 4000 }],
    realizationMode: overrides.realizationMode ?? 'manual',
    yieldRate: overrides.yieldRate,
    financing: overrides.financing,
    scheduledMovements: overrides.scheduledMovements ?? [],
    initialBalance: overrides.initialBalance,
    estratoId: null,
    createdAt: new Date(),
  });
}

describe('runProjection', () => {
  it('should use initialBalance as starting point for calculations', () => {
    const allocations = [
      makeAllocation({
        id: 'reserva',
        target: 10000,
        monthlyAmount: [{ month: 0, amount: 4000 }],
        realizationMode: 'manual',
        initialBalance: 2500,
      }),
    ];
    const result = runProjection(defaultPremises, allocations, defaultStartDate, 1);

    // Month 0: 2500 initial + 4000 deposit = 6500
    expect(result[0].allocations['reserva']).toBe(6500);
  });

  it('should calculate basic surplus correctly', () => {
    const allocations = [makeAllocation()];
    const result = runProjection(defaultPremises, allocations, defaultStartDate, 1);

    expect(result).toHaveLength(1);
    expect(result[0].income).toBe(10000);
    expect(result[0].costOfLiving).toBe(6000);
    expect(result[0].surplus).toBe(0);
    expect(result[0].cash).toBe(0);
    expect(result[0].allocations['reserva']).toBe(4000);
  });

  it('should return correct month numbers and dates', () => {
    const startDate = new Date(2026, 2, 1);
    const result = runProjection(defaultPremises, [makeAllocation()], startDate, 3);

    expect(result[0].month).toBe(0);
    expect(result[0].date.getUTCMonth()).toBe(2); // March
    expect(result[1].month).toBe(1);
    expect(result[1].date.getUTCMonth()).toBe(3); // April
    expect(result[2].month).toBe(2);
    expect(result[2].date.getUTCMonth()).toBe(4); // May
  });

  it('should handle salary change points', () => {
    const premises: Premises = {
      salaryChangePoints: [
        { month: 0, amount: 10000 },
        { month: 3, amount: 15000 },
      ],
      costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
    };
    const result = runProjection(premises, [], defaultStartDate, 5);

    expect(result[0].income).toBe(10000);
    expect(result[2].income).toBe(10000);
    expect(result[3].income).toBe(15000);
    expect(result[4].income).toBe(15000);
  });

  it('should handle cost of living change points', () => {
    const premises: Premises = {
      salaryChangePoints: [{ month: 0, amount: 10000 }],
      costOfLivingChangePoints: [
        { month: 0, amount: 6000 },
        { month: 2, amount: 5000 },
      ],
    };
    const result = runProjection(premises, [], defaultStartDate, 4);

    expect(result[0].costOfLiving).toBe(6000);
    expect(result[1].costOfLiving).toBe(6000);
    expect(result[2].costOfLiving).toBe(5000);
    expect(result[3].costOfLiving).toBe(5000);
  });

  it('should stop box when target is reached', () => {
    const allocations = [
      makeAllocation({
        id: 'reserva',
        target: 5000,
        monthlyAmount: [{ month: 0, amount: 4000 }],
        realizationMode: 'manual',
      }),
    ];
    const result = runProjection(defaultPremises, allocations, defaultStartDate, 3);

    expect(result[0].allocations['reserva']).toBe(4000);
    expect(result[0].allocationPayments['reserva']).toBe(4000);
    expect(result[1].allocations['reserva']).toBe(5000);
    expect(result[1].allocationPayments['reserva']).toBe(1000);
    expect(result[2].allocations['reserva']).toBe(5000);
    expect(result[2].allocationPayments['reserva']).toBe(0);
    expect(result[2].cash).toBeGreaterThan(0);
  });

  it('should handle box with no monthly amount (only scheduled payments)', () => {
    const allocations = [
      makeAllocation({
        id: 'pontual',
        label: 'Pontual',
        target: 50000,
        monthlyAmount: [],
        realizationMode: 'immediate',
        scheduledMovements: [{ month: 2, amount: 10000, label: 'Entrada', type: 'in' }],
      }),
    ];
    const result = runProjection(defaultPremises, allocations, defaultStartDate, 4);

    expect(result[0].allocationPayments['pontual']).toBe(0);
    expect(result[1].allocationPayments['pontual']).toBe(0);
    expect(result[2].allocationPayments['pontual']).toBe(10000);
    expect(result[2].allocations['pontual']).toBe(10000);
    expect(result[3].allocationPayments['pontual']).toBe(0);
  });

  it('should replace monthly with scheduled payment by default', () => {
    const allocations = [
      makeAllocation({
        id: 'terreno',
        label: 'Terreno',
        target: 100000,
        monthlyAmount: [{ month: 0, amount: 2000 }],
        realizationMode: 'immediate',
        scheduledMovements: [
          { month: 1, amount: 10000, label: 'Entrada 1/4', type: 'in' },
        ],
      }),
    ];
    const result = runProjection(defaultPremises, allocations, defaultStartDate, 3);

    expect(result[0].allocationPayments['terreno']).toBe(2000);
    expect(result[1].allocationPayments['terreno']).toBe(10000);
    expect(result[1].scheduledMovements).toEqual([
      { allocationId: 'terreno', amount: 10000, label: 'Entrada 1/4', type: 'in' },
    ]);
    expect(result[2].allocationPayments['terreno']).toBe(2000);
  });

  it('should add monthly when additionalToMonthly is true', () => {
    const allocations = [
      makeAllocation({
        id: 'terreno',
        label: 'Terreno',
        target: 0,
        monthlyAmount: [{ month: 0, amount: 2000 }],
        realizationMode: 'immediate',
        scheduledMovements: [
          {
            month: 1,
            amount: 10000,
            label: 'Extra',
            type: 'in',
            additionalToMonthly: true,
          },
        ],
      }),
    ];
    const result = runProjection(defaultPremises, allocations, defaultStartDate, 2);

    expect(result[1].allocationPayments['terreno']).toBe(12000);
  });

  it('should sum multiple scheduled payments in same month same box', () => {
    const allocations = [
      makeAllocation({
        id: 'terreno',
        label: 'Terreno',
        target: 0,
        monthlyAmount: [{ month: 0, amount: 1000 }],
        realizationMode: 'immediate',
        scheduledMovements: [
          { month: 2, amount: 5000, label: 'Part A', type: 'in' },
          { month: 2, amount: 3000, label: 'Part B', type: 'in' },
        ],
      }),
    ];
    const result = runProjection(defaultPremises, allocations, defaultStartDate, 3);

    expect(result[2].allocationPayments['terreno']).toBe(8000);
    expect(result[2].scheduledMovements).toHaveLength(2);
  });

  it('should NOT cap scheduled payments at target', () => {
    const allocations = [
      makeAllocation({
        id: 'box',
        label: 'Box',
        target: 5000,
        monthlyAmount: [{ month: 0, amount: 1000 }],
        realizationMode: 'manual',
        scheduledMovements: [
          { month: 3, amount: 10000, label: 'Big payment', type: 'in' },
        ],
      }),
    ];
    const result = runProjection(defaultPremises, allocations, defaultStartDate, 5);

    expect(result[2].allocations['box']).toBe(3000);
    expect(result[3].allocations['box']).toBe(13000);
    expect(result[3].allocationPayments['box']).toBe(10000);
    expect(result[4].allocationPayments['box']).toBe(0);
  });

  it('should execute scheduled payments even after target is reached', () => {
    const allocations = [
      makeAllocation({
        id: 'box',
        label: 'Box',
        target: 2000,
        monthlyAmount: [{ month: 0, amount: 1000 }],
        realizationMode: 'immediate',
        scheduledMovements: [{ month: 3, amount: 5000, label: 'Lump sum', type: 'in' }],
      }),
    ];
    const result = runProjection(defaultPremises, allocations, defaultStartDate, 5);

    // Month 0: +1000 (balance 1000)
    // Month 1: +1000 (balance 2000 = target reached)
    // Month 2: target reached, no monthly (balance 2000)
    // Month 3: scheduled payment fires despite target reached (balance 7000)
    // Month 4: target reached, no monthly (balance 7000)
    expect(result[1].allocations['box']).toBe(2000);
    expect(result[2].allocationPayments['box']).toBe(0);
    expect(result[3].allocationPayments['box']).toBe(5000);
    expect(result[3].allocations['box']).toBe(7000);
    expect(result[3].scheduledMovements).toEqual([
      { allocationId: 'box', amount: 5000, label: 'Lump sum', type: 'in' },
    ]);
    expect(result[4].allocationPayments['box']).toBe(0);
  });

  it('should handle negative surplus (cash goes negative)', () => {
    const premises: Premises = {
      salaryChangePoints: [{ month: 0, amount: 5000 }],
      costOfLivingChangePoints: [{ month: 0, amount: 7000 }],
    };
    const result = runProjection(premises, [], defaultStartDate, 3);

    expect(result[0].surplus).toBe(-2000);
    expect(result[0].cash).toBe(-2000);
    expect(result[1].cash).toBe(-4000);
    expect(result[2].cash).toBe(-6000);
  });

  it('should compute totalWealth and totalCommitted correctly', () => {
    const premises: Premises = {
      salaryChangePoints: [{ month: 0, amount: 20000 }],
      costOfLivingChangePoints: [{ month: 0, amount: 10000 }],
    };
    const allocations = [
      makeAllocation({
        id: 'reserva',
        label: 'Reserva',
        target: 0,
        monthlyAmount: [{ month: 0, amount: 3000 }],
        realizationMode: 'manual',
      }),
      makeAllocation({
        id: 'terreno',
        label: 'Terreno',
        target: 0,
        monthlyAmount: [{ month: 0, amount: 2000 }],
        realizationMode: 'immediate',
      }),
    ];
    const result = runProjection(premises, allocations, defaultStartDate, 1);

    expect(result[0].surplus).toBe(5000);
    expect(result[0].cash).toBe(5000);
    expect(result[0].totalWealth).toBe(8000);
    expect(result[0].totalCommitted).toBe(2000);
  });

  it('should default to 120 months when no explicit months given', () => {
    const result = runProjection(defaultPremises, [], defaultStartDate);
    expect(result).toHaveLength(120);
  });

  it('should handle change point without month 0 (uses fallback 0)', () => {
    const premises: Premises = {
      salaryChangePoints: [{ month: 5, amount: 10000 }],
      costOfLivingChangePoints: [{ month: 0, amount: 0 }],
    };
    const result = runProjection(premises, [], defaultStartDate, 7);

    expect(result[0].income).toBe(0);
    expect(result[4].income).toBe(0);
    expect(result[5].income).toBe(10000);
    expect(result[6].income).toBe(10000);
  });

  it('should handle box monthlyAmount change points', () => {
    const premises: Premises = {
      salaryChangePoints: [{ month: 0, amount: 20000 }],
      costOfLivingChangePoints: [{ month: 0, amount: 5000 }],
    };
    const allocations = [
      makeAllocation({
        id: 'terreno',
        label: 'Terreno',
        target: 0,
        monthlyAmount: [
          { month: 0, amount: 1893 },
          { month: 10, amount: 2741 },
        ],
        realizationMode: 'immediate',
      }),
    ];
    const result = runProjection(premises, allocations, defaultStartDate, 12);

    expect(result[0].allocationPayments['terreno']).toBe(1893);
    expect(result[9].allocationPayments['terreno']).toBe(1893);
    expect(result[10].allocationPayments['terreno']).toBe(2741);
    expect(result[11].allocationPayments['terreno']).toBe(2741);
  });

  it('should handle empty boxes', () => {
    const result = runProjection(defaultPremises, [], defaultStartDate, 3);

    expect(result).toHaveLength(3);
    expect(result[0].surplus).toBe(4000);
    expect(result[0].cash).toBe(4000);
    expect(Object.keys(result[0].allocations)).toHaveLength(0);
  });

  it('should handle boxes deducting unconditionally even when cash is negative', () => {
    const premises: Premises = {
      salaryChangePoints: [{ month: 0, amount: 10000 }],
      costOfLivingChangePoints: [{ month: 0, amount: 9500 }],
    };
    const allocations = [
      makeAllocation({
        id: 'acoes',
        label: 'Acoes',
        target: 0,
        monthlyAmount: [{ month: 0, amount: 800 }],
        realizationMode: 'manual',
      }),
    ];
    const result = runProjection(premises, allocations, defaultStartDate, 1);

    expect(result[0].surplus).toBe(-300);
    expect(result[0].cash).toBe(-300);
    expect(result[0].allocations['acoes']).toBe(800);
  });

  it('should project real plan.md scenario (4 down payments)', () => {
    const premises: Premises = {
      salaryChangePoints: [{ month: 0, amount: 33000 }],
      costOfLivingChangePoints: [{ month: 0, amount: 18000 }],
    };
    const allocations = [
      makeAllocation({
        id: 'terreno',
        label: 'Parcela terreno',
        target: 530000,
        monthlyAmount: [{ month: 0, amount: 1893 }],
        realizationMode: 'immediate',
        scheduledMovements: [
          { month: 0, amount: 10000, label: 'Entrada 1/4', type: 'in' },
          { month: 1, amount: 10000, label: 'Entrada 2/4', type: 'in' },
          { month: 2, amount: 10000, label: 'Entrada 3/4', type: 'in' },
          { month: 3, amount: 23000, label: 'Entrada 4/4', type: 'in' },
        ],
      }),
      makeAllocation({
        id: 'acoes',
        label: 'Acoes',
        target: 0,
        monthlyAmount: [{ month: 0, amount: 800 }],
        realizationMode: 'manual',
      }),
    ];
    const result = runProjection(premises, allocations, defaultStartDate, 6);

    expect(result[0].income).toBe(33000);
    expect(result[0].allocationPayments['terreno']).toBe(10000);
    expect(result[0].allocationPayments['acoes']).toBe(800);
    expect(result[0].surplus).toBe(4200);

    expect(result[3].allocationPayments['terreno']).toBe(23000);
    expect(result[3].surplus).toBe(-8800);
    expect(result[3].cash).toBe(3800);

    expect(result[4].allocationPayments['terreno']).toBe(1893);
    expect(result[4].surplus).toBe(33000 - 18000 - 1893 - 800);
  });

  describe('yield', () => {
    it('should apply monthly yield to holdsFunds box', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          yieldRate: 0.12,
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 1);

      const expectedYield = 1000 * (0.12 / 12);
      expect(result[0].allocationYields['reserva']).toBeCloseTo(expectedYield);
      expect(result[0].allocations['reserva']).toBeCloseTo(1000 + expectedYield);
    });

    it('should compound yield over multiple months', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          yieldRate: 0.12,
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 2);

      // Month 0: deposit 1000, yield = 1000 * 0.01 = 10, balance = 1010
      // Month 1: deposit 1000, balance before yield = 2010, yield = 2010 * 0.01 = 20.10
      expect(result[1].allocationYields['reserva']).toBeCloseTo(2010 * 0.01);
      expect(result[1].allocations['reserva']).toBeCloseTo(2010 + 2010 * 0.01);
    });

    it('should stop yielding after target is reached (targetReached is permanent)', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 2000,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          yieldRate: 0.12,
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 4);

      // Month 0: deposit 1000, yield on 1000 = 10. accumulated = 1010. Not yet at target.
      // Month 1: deposit min(1000, 2000-1010) = 990. accumulated = 2000 = target. targetReached set. No yield.
      // Month 2: targetReached, no outflow, no yield. balance stays at 2000.
      expect(result[2].allocationPayments['reserva']).toBe(0);
      expect(result[2].allocationYields['reserva']).toBe(0);
      expect(result[2].allocations['reserva']).toBeCloseTo(2000);
    });

    it('should not yield on holdsFunds: false box', () => {
      const allocations = [
        makeAllocation({
          id: 'terreno',
          label: 'Terreno',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 2000 }],
          realizationMode: 'immediate',
          yieldRate: 0.12,
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 2);

      expect(result[0].allocationYields['terreno']).toBe(0);
      expect(result[1].allocationYields['terreno']).toBe(0);
      expect(result[1].allocations['terreno']).toBe(4000);
    });

    it('should not yield when yieldRate is undefined', () => {
      const allocations = [makeAllocation()];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 1);

      expect(result[0].allocationYields['reserva']).toBe(0);
    });

    it('should not yield when yieldRate is 0', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          yieldRate: 0,
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 1);

      expect(result[0].allocationYields['reserva']).toBe(0);
      expect(result[0].allocations['reserva']).toBe(1000);
    });

    it('should aggregate totalYield across all boxes', () => {
      const premises: Premises = {
        salaryChangePoints: [{ month: 0, amount: 20000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 10000 }],
      };
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 3000 }],
          realizationMode: 'manual',
          yieldRate: 0.12,
        }),
        makeAllocation({
          id: 'acoes',
          label: 'Acoes',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 2000 }],
          realizationMode: 'manual',
          yieldRate: 0.06,
        }),
      ];
      const result = runProjection(premises, allocations, defaultStartDate, 1);

      const expectedTotal =
        result[0].allocationYields['reserva'] + result[0].allocationYields['acoes'];
      expect(result[0].totalYield).toBeCloseTo(expectedTotal);
    });

    it('should include yield in totalWealth', () => {
      const premises: Premises = {
        salaryChangePoints: [{ month: 0, amount: 10000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 9000 }],
      };
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          yieldRate: 0.12,
        }),
      ];
      const result = runProjection(premises, allocations, defaultStartDate, 1);

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
      const allocations = [
        makeAllocation({
          id: 'fin',
          label: 'Casa',
          target: 0,
          monthlyAmount: [],
          realizationMode: 'immediate',
          financing: {
            principal: 120_000,
            annualRate: 0.12,
            termMonths: 12,
            system: 'sac',
          },
        }),
      ];

      const result = runProjection(defaultPremises, allocations, defaultStartDate, 12);
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
      const allocations = [
        makeAllocation({
          id: 'car',
          label: 'Carro',
          target: 0,
          monthlyAmount: [],
          realizationMode: 'immediate',
          financing: {
            principal: 60_000,
            annualRate: 0.18,
            termMonths: 24,
            system: 'price',
          },
        }),
      ];

      const result = runProjection(defaultPremises, allocations, defaultStartDate, 24);

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
      const premises: Premises = {
        salaryChangePoints: [{ month: 0, amount: 50_000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 20_000 }],
      };
      const allocations = [
        makeAllocation({
          id: 'obra',
          label: 'Financiamento Obra',
          target: 0,
          monthlyAmount: [],
          realizationMode: 'immediate',
          financing: {
            principal: 1_200_000,
            annualRate: 0.11,
            termMonths: 420,
            system: 'sac',
            constructionMonths: 16,
          },
        }),
      ];

      const result = runProjection(premises, allocations, defaultStartDate, 18);

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
      const allocations = [
        makeAllocation({
          id: 'fin',
          label: 'Casa',
          target: 0,
          monthlyAmount: [],
          realizationMode: 'immediate',
          financing: {
            principal: 12_000,
            annualRate: 0.12,
            termMonths: 12,
            system: 'sac',
          },
        }),
      ];

      const result = runProjection(defaultPremises, allocations, defaultStartDate, 1);
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
      // Box balance (allocations['fin']) = principal - outstanding = 120k - 110k = R$10.000
      //   Isso reflete amortizacao acumulada, NAO total pago.
      //   Juros sao custo puro, nao constroem patrimonio.
      //
      // totalCommitted = soma dos balances de allocations holdsFunds:false = R$10.000
      const allocations = [
        makeAllocation({
          id: 'fin',
          label: 'Casa',
          target: 0,
          monthlyAmount: [],
          realizationMode: 'immediate',
          financing: {
            principal: 120_000,
            annualRate: 0.12,
            termMonths: 12,
            system: 'sac',
          },
        }),
      ];

      const result = runProjection(defaultPremises, allocations, defaultStartDate, 1);

      expect(result[0].allocations['fin']).toBeCloseTo(10_000, 0);
      expect(result[0].totalCommitted).toBeCloseTo(10_000, 0);
    });

    it('should handle extra amortization from cash', () => {
      // SAC R$120.000 a 12% a.a. (1% a.m.) em 12 meses.
      // type: 'in' movement de R$50.000 no mes 1 (sai do caixa como extra amortization).
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
      const allocations = [
        makeAllocation({
          id: 'fin',
          label: 'Casa',
          target: 0,
          monthlyAmount: [],
          realizationMode: 'immediate',
          scheduledMovements: [
            { month: 1, amount: 50_000, label: 'Amortizacao extra', type: 'in' },
          ],
          financing: {
            principal: 120_000,
            annualRate: 0.12,
            termMonths: 12,
            system: 'sac',
          },
        }),
      ];

      const result = runProjection(defaultPremises, allocations, defaultStartDate, 3);

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
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 5000 }],
          realizationMode: 'manual',
          scheduledMovements: [
            {
              month: 2,
              amount: 10_000,
              label: 'Entrada da reserva',
              type: 'out',
              destinationBoxId: 'fin',
            },
          ],
        }),
        makeAllocation({
          id: 'fin',
          label: 'Casa',
          target: 0,
          monthlyAmount: [],
          realizationMode: 'immediate',
          financing: {
            principal: 120_000,
            annualRate: 0.12,
            termMonths: 12,
            system: 'sac',
          },
        }),
      ];

      const result = runProjection(defaultPremises, allocations, defaultStartDate, 4);

      // Month 0-1: reserva = 5k + 5k = 10k
      expect(result[1].allocations['reserva']).toBeCloseTo(10_000, 0);

      // Month 2: reserva = 15k - 10k(transfer) = 5k
      expect(result[2].allocations['reserva']).toBeCloseTo(5_000, 0);
      // Cash unaffected by type: 'out' with destinationBoxId transfer (no cash outflow for this)
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
      //   Passo 1: processa todas as allocations regulares (depositos + out movements)
      //   Passo 2: processa todas as allocations de financiamento (extra amortizations acumuladas)
      //   Ambas as ordens: reserva = 10k apos deposito, deducao = 8k => reserva = 2k
      const reserva = makeAllocation({
        id: 'reserva',
        label: 'Reserva',
        target: 0,
        monthlyAmount: [{ month: 0, amount: 5000 }],
        realizationMode: 'manual',
        scheduledMovements: [
          {
            month: 1,
            amount: 8_000,
            label: 'Entrada',
            type: 'out' as const,
            destinationBoxId: 'fin',
          },
        ],
      });

      const fin = makeAllocation({
        id: 'fin',
        label: 'Casa',
        target: 0,
        monthlyAmount: [],
        realizationMode: 'immediate',
        financing: {
          principal: 120_000,
          annualRate: 0.12,
          termMonths: 12,
          system: 'sac' as const,
        },
      });

      const resultA = runProjection(defaultPremises, [reserva, fin], defaultStartDate, 3);
      const resultB = runProjection(defaultPremises, [fin, reserva], defaultStartDate, 3);

      // Both orderings should produce identical results at month 1
      expect(resultA[1].allocations['reserva']).toBeCloseTo(
        resultB[1].allocations['reserva'],
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
      //   totalWealth = caixa + soma(allocations com holdsFunds:true)
      //   totalCommitted = soma(allocations com holdsFunds:false)
      //
      // SAC R$12.000 a 12% a.a. em 12 meses (financing allocation, holdsFunds:false).
      //   Mes 0: amort = 12.000/12 = R$1.000
      //   balance = principal - outstanding = 12k - 11k = R$1.000
      //
      // totalCommitted = R$1.000 (progresso da amortizacao)
      // totalWealth = caixa apenas (nao ha allocations holdsFunds:true neste plano)
      //   caixa = salario(10k) - custo(6k) - prestacao(1.120) = R$2.880
      const allocations = [
        makeAllocation({
          id: 'fin',
          label: 'Casa',
          target: 0,
          monthlyAmount: [],
          realizationMode: 'immediate',
          financing: {
            principal: 12_000,
            annualRate: 0.12,
            termMonths: 12,
            system: 'sac',
          },
        }),
      ];

      const result = runProjection(defaultPremises, allocations, defaultStartDate, 1);

      expect(result[0].totalCommitted).toBeCloseTo(1_000, 0);
      expect(result[0].totalWealth).toBeCloseTo(result[0].cash, 0);
    });
  });

  describe('scheduled movements - type out', () => {
    it('should return withdrawn amount to cash when out movement has no destinationBoxId', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 50000,
          monthlyAmount: [{ month: 0, amount: 4000 }],
          realizationMode: 'manual',
          initialBalance: 10000,
          scheduledMovements: [
            { label: 'Saque', month: 2, amount: 5000, type: 'out' },
          ],
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 4);

      // Month 0: balance = 10000 + 4000 = 14000
      // Month 1: balance = 14000 + 4000 = 18000
      // Month 2: balance = 18000 + 4000 - 5000 = 17000
      // Surplus without withdrawal = 10000 - 6000 - 4000 = 0
      // Surplus with withdrawal = 10000 - 6000 - 4000 + 5000 = 5000
      // Cash: 0 + 0 + 5000 = 5000
      expect(result[2].allocations['reserva']).toBe(17000);
      expect(result[2].cash).toBe(5000);
      expect(result[2].scheduledMovements).toContainEqual(
        expect.objectContaining({ allocationId: 'reserva', amount: 5000, type: 'out' }),
      );
    });

    it('should transfer withdrawn amount to destination regular box', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 2000 }],
          realizationMode: 'manual',
          initialBalance: 10000,
          scheduledMovements: [
            { label: 'Transferência', month: 1, amount: 3000, type: 'out', destinationBoxId: 'casamento' },
          ],
        }),
        makeAllocation({
          id: 'casamento',
          label: 'Casamento',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 3);

      // Month 0: reserva = 10000 + 2000 = 12000, casamento = 1000
      // surplus = 10000 - 6000 - 2000 - 1000 = 1000
      // Month 1: reserva = 12000 + 2000 - 3000 = 11000, casamento = 1000 + 1000 + 3000 = 5000
      // surplus = 10000 - 6000 - 2000 - 1000 = 1000 (transfer doesn't affect cash)
      expect(result[1].allocations['reserva']).toBe(11000);
      expect(result[1].allocations['casamento']).toBe(5000);
      // Cash flow unaffected by box-to-box transfer (surplus is same both months)
      expect(result[1].surplus).toBe(result[0].surplus);
    });

    it('should cap withdrawal at available balance when amount exceeds it', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 2000 }],
          realizationMode: 'manual',
          initialBalance: 1000,
          scheduledMovements: [
            { label: 'Saque grande', month: 0, amount: 50000, type: 'out' },
          ],
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 2);

      // Month 0: deposit 2000 (balance = 1000 + 2000 = 3000), then withdrawal capped at 3000
      expect(result[0].allocations['reserva']).toBe(0);
      // Cash = surplus(10000 - 6000 - 2000 + 3000) = 5000
      expect(result[0].cash).toBe(5000);
      expect(result[0].scheduledMovements[0].amount).toBe(3000); // effective amount, not 50000
    });

    it('should accumulate withdrawal to financing box as extra amortization', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 5000 }],
          realizationMode: 'manual',
          initialBalance: 10000,
          scheduledMovements: [
            { label: 'Amortização extra', month: 2, amount: 8000, type: 'out', destinationBoxId: 'financiamento' },
          ],
        }),
        makeAllocation({
          id: 'financiamento',
          label: 'Financiamento',
          target: 0,
          realizationMode: 'immediate',
          monthlyAmount: [],
          financing: {
            principal: 500000,
            annualRate: 0.12,
            termMonths: 360,
            system: 'sac' as const,
          },
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 4);

      // Month 2: reserva deposits 5000 (balance = 20000 + 5000 = 25000)
      // then withdrawal of 8000 → reserva = 17000
      // 8000 goes as extra amortization to financing
      expect(result[2].allocations['reserva']).toBeCloseTo(17000, -2);
      // Financing outstanding balance should reflect extra amortization of 8000
      // The extra amort is applied first, then SAC recalculates regular amort on the reduced balance.
      // So the total reduction = 8000 (extra) + regular amort (recalculated on post-extra balance).
      const withoutExtra = result[1].financingDetails['financiamento'].outstandingBalance;
      const withExtra = result[2].financingDetails['financiamento'].outstandingBalance;
      // Reduction must be greater than 8000 (extra alone) because regular amort also applies
      expect(withoutExtra - withExtra).toBeGreaterThan(8000);
      // And the extra amortization should make month 2 outstanding notably lower
      // than it would be with just regular amortization (~1388/mo for 500k/360)
      const regularOnlyReduction = result[0].financingDetails['financiamento'].amortization;
      expect(withoutExtra - withExtra).toBeGreaterThan(regularOnlyReduction + 7000);
    });

    it('should NOT resume monthly contributions after withdrawal drops balance below target (targetReached is permanent)', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 20000,
          monthlyAmount: [{ month: 0, amount: 4000 }],
          realizationMode: 'manual',
          initialBalance: 15000,
          scheduledMovements: [
            { label: 'Saque', month: 1, amount: 10000, type: 'out' },
          ],
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 4);

      // Month 0: 15000 + 4000 = 19000. accumulated = 19000 < 20000. targetReached not set.
      // Month 1: 19000 + min(4000, 1000) = 20000 (capped at target). targetReached set. Then -10000 = 10000.
      // Month 2: targetReached, no monthly. balance stays 10000.
      // Month 3: targetReached, no monthly. balance stays 10000.
      expect(result[1].allocations['reserva']).toBe(10000);
      expect(result[2].allocations['reserva']).toBe(10000);
      expect(result[3].allocations['reserva']).toBe(10000);
    });

    it('should allow in movements to exceed target', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          label: 'Reserva',
          target: 10000,
          monthlyAmount: [{ month: 0, amount: 4000 }],
          realizationMode: 'manual',
          scheduledMovements: [
            { label: 'Aporte extra', month: 2, amount: 15000, type: 'in' },
          ],
        }),
      ];
      const result = runProjection(defaultPremises, allocations, defaultStartDate, 4);

      // Month 0: 4000, Month 1: 8000
      // Month 2: scheduled in replaces monthly (additionalToMonthly default false) → 15000
      // balance = 8000 + 15000 = 23000 (exceeds target 10000 — allowed)
      expect(result[2].allocations['reserva']).toBe(23000);
      // Month 3: target already exceeded, monthly = 0 (capped)
      expect(result[3].allocations['reserva']).toBe(23000);
    });
  });

  describe('hybrid projection with realData', () => {
    it('uses real data for past months and premissas for future', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 1000 }],
        }),
      ];

      const realData: RealMonthData[] = [
        {
          month: 0,
          realIncome: 35000,
          realCostOfLiving: 20000,
          allocationPayments: [{ allocationId: 'reserva', amount: 1500 }],
        },
        {
          month: 1,
          realIncome: 33000,
          realCostOfLiving: 16000,
          allocationPayments: [{ allocationId: 'reserva', amount: 800 }],
        },
      ];

      const result = runProjection(
        defaultPremises,
        allocations,
        defaultStartDate,
        6,
        realData,
        2,
      );

      // Month 0: real data
      expect(result[0].income).toBe(35000);
      expect(result[0].costOfLiving).toBe(20000);
      expect(result[0].isReal).toBe(true);
      expect(result[0].allocationPayments['reserva']).toBe(1500);

      // Month 1: real data
      expect(result[1].income).toBe(33000);
      expect(result[1].costOfLiving).toBe(16000);
      expect(result[1].isReal).toBe(true);
      expect(result[1].allocationPayments['reserva']).toBe(800);

      // Month 2: premissa (currentMonth=2, so month 2 onwards is projected)
      expect(result[2].income).toBe(10000);
      expect(result[2].costOfLiving).toBe(6000);
      expect(result[2].isReal).toBe(false);
    });

    it('without realData, all months use premissas (backward compat)', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 1000 }],
        }),
      ];

      const result = runProjection(
        defaultPremises,
        allocations,
        defaultStartDate,
        6,
      );

      expect(result.every((m) => !m.isReal)).toBe(true);
      // All months should use premissa values
      expect(result[0].income).toBe(10000);
      expect(result[0].costOfLiving).toBe(6000);
    });

    it('real allocation payments override computed outflow', () => {
      const allocations = [
        makeAllocation({
          id: 'terreno',
          target: 100000,
          monthlyAmount: [{ month: 0, amount: 2000 }],
          realizationMode: 'immediate',
        }),
      ];

      const realData: RealMonthData[] = [
        {
          month: 0,
          realIncome: 10000,
          realCostOfLiving: 6000,
          allocationPayments: [{ allocationId: 'terreno', amount: 5000 }],
        },
      ];

      const result = runProjection(
        defaultPremises,
        allocations,
        defaultStartDate,
        3,
        realData,
        1,
      );

      // Month 0: real allocation payment of 5000 instead of computed 2000
      expect(result[0].allocationPayments['terreno']).toBe(5000);
      expect(result[0].allocations['terreno']).toBe(5000);
      expect(result[0].isReal).toBe(true);

      // Month 1: projected, uses premissa value of 2000
      expect(result[1].allocationPayments['terreno']).toBe(2000);
      expect(result[1].allocations['terreno']).toBe(7000);
      expect(result[1].isReal).toBe(false);
    });

    it('cash accumulates correctly across real and projected months', () => {
      const allocations: Allocation[] = [];

      const realData: RealMonthData[] = [
        {
          month: 0,
          realIncome: 12000,
          realCostOfLiving: 8000,
          allocationPayments: [],
        },
      ];

      const result = runProjection(
        defaultPremises,
        allocations,
        defaultStartDate,
        3,
        realData,
        1,
      );

      // Month 0: real surplus = 12000 - 8000 = 4000
      expect(result[0].cash).toBe(4000);
      expect(result[0].isReal).toBe(true);

      // Month 1: projected surplus = 10000 - 6000 = 4000, cash = 4000 + 4000 = 8000
      expect(result[1].cash).toBe(8000);
      expect(result[1].isReal).toBe(false);

      // Month 2: projected surplus = 4000, cash = 8000 + 4000 = 12000
      expect(result[2].cash).toBe(12000);
      expect(result[2].isReal).toBe(false);
    });

    it('real data with empty allocationPayments uses computed outflow for allocations', () => {
      const allocations = [
        makeAllocation({
          id: 'reserva',
          target: 0,
          monthlyAmount: [{ month: 0, amount: 1000 }],
        }),
      ];

      const realData: RealMonthData[] = [
        {
          month: 0,
          realIncome: 15000,
          realCostOfLiving: 7000,
          allocationPayments: [],
        },
      ];

      const result = runProjection(
        defaultPremises,
        allocations,
        defaultStartDate,
        2,
        realData,
        1,
      );

      // Month 0: real income/costOfLiving, but no real allocation payments
      // so computed outflow is used for allocation
      expect(result[0].income).toBe(15000);
      expect(result[0].costOfLiving).toBe(7000);
      expect(result[0].isReal).toBe(true);
      expect(result[0].allocationPayments['reserva']).toBe(1000); // computed
    });
  });

  describe('realization mode', () => {
    const startDate = new Date('2026-01-01');

    it('immediate mode: accumulated and realized track together, em_mãos always 0', () => {
      const alloc = makeAllocation({
        realizationMode: 'immediate',
        monthlyAmount: [{ month: 0, amount: 1000 }],
        target: 0,
      });

      const result = runProjection(defaultPremises, [alloc], startDate, 3);

      expect(result[0].allocationAccumulated[alloc.id]).toBe(1000);
      expect(result[0].allocationRealized[alloc.id]).toBe(1000);
      const emMaos =
        result[0].allocationAccumulated[alloc.id] - result[0].allocationRealized[alloc.id];
      expect(emMaos).toBe(0);
    });

    it('manual mode: accumulated grows, realized stays 0, em_mãos = accumulated', () => {
      const alloc = makeAllocation({
        realizationMode: 'manual',
        monthlyAmount: [{ month: 0, amount: 1000 }],
        target: 5000,
      });
      const result = runProjection(defaultPremises, [alloc], startDate, 3);
      expect(result[2].allocationAccumulated[alloc.id]).toBe(3000);
      expect(result[2].allocationRealized[alloc.id]).toBe(0);
      expect(result[2].totalWealth).toBeGreaterThan(result[2].cash);
    });

    it('manual mode: yield applies on em_mãos and increments accumulated', () => {
      const alloc = makeAllocation({
        realizationMode: 'manual',
        monthlyAmount: [{ month: 0, amount: 1000 }],
        target: 0,
        yieldRate: 0.12,
      });
      const result = runProjection(defaultPremises, [alloc], startDate, 2);
      expect(result[0].allocationAccumulated[alloc.id]).toBeCloseTo(1010);
      expect(result[0].allocationRealized[alloc.id]).toBe(0);
    });

    it('manual mode: aportes stop permanently when accumulated >= target', () => {
      const alloc = makeAllocation({
        realizationMode: 'manual',
        monthlyAmount: [{ month: 0, amount: 1000 }],
        target: 2500,
      });
      const result = runProjection(defaultPremises, [alloc], startDate, 5);
      expect(result[2].allocationAccumulated[alloc.id]).toBe(2500);
      expect(result[3].allocationPayments[alloc.id]).toBe(0);
      expect(result[3].allocationAccumulated[alloc.id]).toBe(2500);
    });

    it('manual mode: yield stops after target reached', () => {
      const alloc = makeAllocation({
        realizationMode: 'manual',
        monthlyAmount: [{ month: 0, amount: 10000 }],
        target: 10000,
        yieldRate: 0.12,
      });
      const result = runProjection(defaultPremises, [alloc], startDate, 3);
      // Month 0: deposit 10000, target reached, yield applied this month
      // Month 1: targetReached=true, no yield
      expect(result[1].allocationYields[alloc.id]).toBe(0);
    });

    it('onCompletion: realizes all em_mãos when target reached', () => {
      const alloc = makeAllocation({
        realizationMode: 'onCompletion',
        monthlyAmount: [{ month: 0, amount: 5000 }],
        target: 10000,
      });
      const result = runProjection(defaultPremises, [alloc], startDate, 4);

      // Month 0: accumulated=5000, not reached
      expect(result[0].allocationAccumulated[alloc.id]).toBe(5000);
      expect(result[0].allocationRealized[alloc.id]).toBe(0);

      // Month 1: accumulated=10000, target reached → auto-realize
      expect(result[1].allocationAccumulated[alloc.id]).toBe(10000);
      expect(result[1].allocationRealized[alloc.id]).toBe(10000);
      expect(result[1].realizedAllocations).toContain(alloc.id);

      // Month 2: no more payments, realized stays
      expect(result[2].allocationPayments[alloc.id]).toBe(0);
      expect(result[2].allocationAccumulated[alloc.id]).toBe(10000);
      expect(result[2].allocationRealized[alloc.id]).toBe(10000);
    });

    it('onCompletion: totalWealth drops when realized', () => {
      const alloc = makeAllocation({
        realizationMode: 'onCompletion',
        monthlyAmount: [{ month: 0, amount: 10000 }],
        target: 10000,
      });
      const result = runProjection(
        { salaryChangePoints: [{ month: 0, amount: 50000 }], costOfLivingChangePoints: [{ month: 0, amount: 10000 }] },
        [alloc],
        startDate,
        3,
      );
      // Month 0: accumulated=10k, realized=10k, em_mãos=0
      // Wealth = cash(30k) + em_mãos(0) = 30k
      expect(result[0].totalWealth).toBe(30000);
      // Month 1: no payments, surplus=40k
      expect(result[1].totalWealth).toBe(70000);
    });

    it('onCompletion: yield stops after target reached', () => {
      const alloc = makeAllocation({
        realizationMode: 'onCompletion',
        monthlyAmount: [{ month: 0, amount: 10000 }],
        target: 10000,
        yieldRate: 0.12,
      });
      const result = runProjection(defaultPremises, [alloc], startDate, 3);
      expect(result[1].allocationYields[alloc.id]).toBe(0);
      expect(result[2].allocationYields[alloc.id]).toBe(0);
    });
  });
});
