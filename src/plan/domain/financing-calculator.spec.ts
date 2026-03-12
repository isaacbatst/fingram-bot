import { describe, it, expect } from 'vitest';
import {
  getSacInstallment,
  getPriceInstallment,
  getConstructionInterest,
  computeFinancingMonth,
  initFinancingState,
} from './financing-calculator';
import { BoxFinancing } from './plan';

describe('financing-calculator', () => {
  // Taxa anual: 11% a.a.
  // Taxa mensal: 0.11 / 12 = 0.0091667 (~0.917% a.m.)
  const monthlyRate = 0.11 / 12;

  describe('getSacInstallment', () => {
    it('should calculate fixed amortization and declining interest', () => {
      // SAC (Sistema de Amortizacao Constante):
      //   amortizacao = saldo_devedor / parcelas_restantes
      //   juros = saldo_devedor * taxa_mensal
      //   prestacao = amortizacao + juros
      //
      // Inputs: saldo = R$120.000, taxa = 0.917% a.m., parcelas = 12
      //
      // amortizacao = 120.000 / 12 = R$10.000,00
      // juros       = 120.000 * 0.0091667 = R$1.100,00
      // prestacao   = 10.000 + 1.100 = R$11.100,00
      const result = getSacInstallment(120_000, monthlyRate, 12);
      expect(result.amortization).toBeCloseTo(10_000, 0);
      expect(result.interest).toBeCloseTo(120_000 * monthlyRate, 2);
      expect(result.total).toBeCloseTo(
        result.amortization + result.interest,
        2,
      );
    });

    it('should have constant amortization and declining total across months', () => {
      // SAC property: amortizacao e sempre constante = principal / n.
      // A cada mes o saldo diminui, os juros caem, e a prestacao declina.
      //
      // Mes 0:  saldo=120k, amort=10k, juros=120k*r=1100, total=11100
      // Mes 1:  saldo=110k, amort=10k, juros=110k*r=1008, total=11008
      // Mes 2:  saldo=100k, amort=10k, juros=100k*r=917,  total=10917
      // ...
      // Mes 11: saldo=10k,  amort=10k, juros=10k*r=92,    total=10092
      //
      // Ao final: saldo = 120k - 12*10k = R$0,00
      let balance = 120_000;
      const remaining = 12;
      const amortization = balance / remaining; // = 10.000
      let prevTotal = Infinity;

      for (let i = 0; i < remaining; i++) {
        const result = getSacInstallment(balance, monthlyRate, remaining - i);
        expect(result.amortization).toBeCloseTo(amortization, 0);
        expect(result.total).toBeLessThan(prevTotal);
        prevTotal = result.total;
        balance -= result.amortization;
      }
      expect(balance).toBeCloseTo(0, 2);
    });
  });

  describe('getPriceInstallment', () => {
    it('should calculate constant total payment', () => {
      // PRICE (Tabela Price / Sistema Frances):
      //   PMT = P * [r * (1+r)^n] / [(1+r)^n - 1]
      //   juros = saldo * r
      //   amortizacao = PMT - juros
      //
      // Propriedade fundamental: o PMT e constante ao longo de todo o prazo.
      // Recalcular com (saldo - amortizacao, n-1) deve dar o mesmo PMT.
      //
      // Inputs: P=120k, r=0.0091667, n=12
      // (1+r)^12 = 1.0091667^12 = ~1.11572
      // PMT = 120000 * [0.0091667 * 1.11572] / [1.11572 - 1]
      //     = 120000 * 0.010224 / 0.11572 = ~10.601
      const r1 = getPriceInstallment(120_000, monthlyRate, 12);
      // Mes 2: novo saldo = 120k - amort_mes1, parcelas restantes = 11
      const newBalance = 120_000 - r1.amortization;
      const r2 = getPriceInstallment(newBalance, monthlyRate, 11);
      // PMT do mes 2 deve ser igual ao PMT do mes 1
      expect(r2.total).toBeCloseTo(r1.total, 2);
    });

    it('should amortize fully over the term', () => {
      // Simulacao completa de 12 meses:
      //   Cada mes: amortizacao = PMT - juros, saldo -= amortizacao.
      //   Como juros diminuem a cada mes (saldo cai), amortizacao cresce.
      //   Ao final de 12 meses: saldo deve ser R$0,00.
      let balance = 120_000;
      for (let i = 12; i > 0; i--) {
        const result = getPriceInstallment(balance, monthlyRate, i);
        balance -= result.amortization;
      }
      expect(balance).toBeCloseTo(0, 2);
    });

    it('should have increasing amortization over time', () => {
      // PRICE property: como PMT e constante e juros = saldo * r,
      // a medida que o saldo diminui, juros caem, sobrando mais para amortizacao.
      //
      // Exemplo numerico (valores aprox. com taxa 0.917% a.m.):
      //   Mes 0:  juros=1100, amort=PMT-1100 (menor)
      //   Mes 1:  juros=~1000, amort=PMT-1000 (um pouco maior)
      //   ...
      //   Mes 11: juros=~92,   amort=PMT-92   (maior de todos)
      let balance = 120_000;
      let prevAmort = 0;
      for (let i = 12; i > 0; i--) {
        const result = getPriceInstallment(balance, monthlyRate, i);
        expect(result.amortization).toBeGreaterThan(prevAmort);
        prevAmort = result.amortization;
        balance -= result.amortization;
      }
    });
  });

  describe('getConstructionInterest', () => {
    it('should calculate interest on linearly released amount', () => {
      // Juros de obra: o banco libera o financiamento linearmente ao longo da construcao.
      // Por padrao, 95% do principal e liberado (5% retido como garantia).
      //
      // Formula:
      //   liberado_por_mes = (principal * releasePercent) / total_meses_obra
      //   acumulado(m) = liberado_por_mes * (m + 1)
      //   juros(m) = acumulado(m) * taxa_mensal
      //
      // Inputs: principal=R$1.000.000, taxa=0.917% a.m., mes=0, total_meses=16
      //   liberado_por_mes = (1.000.000 * 0.95) / 16 = R$59.375,00
      //   acumulado(0) = 59.375 * 1 = R$59.375,00
      //   juros(0) = 59.375 * 0.0091667 = R$544,27
      const interest = getConstructionInterest(1_000_000, monthlyRate, 0, 16);
      const expected = ((1_000_000 * 0.95) / 16) * 1 * monthlyRate;
      expect(interest).toBeCloseTo(expected, 2);
    });

    it('should grow linearly over construction months', () => {
      // Como acumulado(m) = liberado_por_mes * (m+1), os juros sao proporcionais a (m+1).
      // Portanto juros(m) / juros(0) = (m+1) / 1.
      //
      //   juros(0)  = 59.375 * r  (fator 1)
      //   juros(7)  = 59.375 * 8 * r = 475.000 * r  (fator 8)
      //   juros(15) = 59.375 * 16 * r = 950.000 * r (fator 16)
      //
      //   i7/i0 = 8, i15/i0 = 16
      const i0 = getConstructionInterest(1_000_000, monthlyRate, 0, 16);
      const i7 = getConstructionInterest(1_000_000, monthlyRate, 7, 16);
      const i15 = getConstructionInterest(1_000_000, monthlyRate, 15, 16);

      expect(i7 / i0).toBeCloseTo(8, 1);
      expect(i15 / i0).toBeCloseTo(16, 1);
    });

    it('should match plan.md example at month 12 (11% a.a., R$1.2M)', () => {
      // Referencia do plan.md: juros de obra no mes 12 (indice 11) = R$7.838
      //
      //   liberado_por_mes = (1.200.000 * 0.95) / 16 = R$71.250,00
      //   acumulado(11) = 71.250 * 12 = R$855.000,00
      //   juros(11) = 855.000 * (0.11/12) = 855.000 * 0.0091667 = R$7.837,50
      //
      // Tolerancia de ~R$10 (toBeCloseTo com -1 digitos)
      const interest = getConstructionInterest(1_200_000, 0.11 / 12, 11, 16);
      expect(interest).toBeCloseTo(7838, -1);
    });

    it('should use custom releasePercent when provided', () => {
      // Com releasePercent=0.80 (ao inves do padrao 0.95):
      //   liberado_por_mes = (1.000.000 * 0.80) / 16 = R$50.000,00
      //   acumulado(0) = 50.000 * 1 = R$50.000,00
      //   juros(0) = 50.000 * 0.0091667 = R$458,33
      //
      // Com o padrao (0.95):
      //   juros(0) = 59.375 * 0.0091667 = R$544,27
      //
      // Diferenca de ~R$86 entre os dois
      const interest80 = getConstructionInterest(
        1_000_000,
        monthlyRate,
        0,
        16,
        0.8,
      );
      const expected = ((1_000_000 * 0.8) / 16) * 1 * monthlyRate;
      expect(interest80).toBeCloseTo(expected, 2);

      const interestDefault = getConstructionInterest(
        1_000_000,
        monthlyRate,
        0,
        16,
      );
      expect(interest80).not.toBeCloseTo(interestDefault, 2);
    });
  });

  describe('computeFinancingMonth', () => {
    // SAC: R$120.000 a 12% a.a. (1% a.m.) em 12 meses
    //   amortizacao_mensal = 120.000 / 12 = R$10.000
    //   Mes 0: juros = 120.000 * 0.01 = R$1.200,  prestacao = R$11.200
    //   Mes 1: juros = 110.000 * 0.01 = R$1.100,  prestacao = R$11.100
    //   Mes 2: juros = 100.000 * 0.01 = R$1.000,  prestacao = R$11.000
    //   ...
    //   Mes 11: juros = 10.000 * 0.01 = R$100,    prestacao = R$10.100
    const sacFinancing: BoxFinancing = {
      principal: 120_000,
      annualRate: 0.12,
      termMonths: 12,
      system: 'sac',
    };

    // PRICE: R$120.000 a 12% a.a. (1% a.m.) em 12 meses
    //   PMT = 120.000 * [0.01 * 1.01^12] / [1.01^12 - 1]
    //       = 120.000 * [0.01 * 1.12683] / [0.12683]
    //       = 120.000 * 0.011268 / 0.12683
    //       = 120.000 * 0.088849
    //       = ~R$10.661,85/mes
    const priceFinancing: BoxFinancing = {
      principal: 120_000,
      annualRate: 0.12,
      termMonths: 12,
      system: 'price',
    };

    describe('SAC', () => {
      it('should produce declining payments over full term', () => {
        // Executa todos os 12 meses do SAC.
        // Cada mes: amort = R$10.000 (constante).
        // Juros caem conforme saldo diminui:
        //   Mes 0:  120k * 0.01 = 1.200 => prestacao = 11.200
        //   Mes 1:  110k * 0.01 = 1.100 => prestacao = 11.100
        //   ...
        //   Mes 11: 10k * 0.01  = 100   => prestacao = 10.100
        // Saldo apos 12 meses: 120k - 12*10k = R$0
        let state = initFinancingState(sacFinancing);
        const payments: number[] = [];

        for (let i = 0; i < 12; i++) {
          const { detail, nextState } = computeFinancingMonth(
            sacFinancing,
            state,
            i,
            0,
          );
          payments.push(detail.payment);
          expect(detail.phase).toBe('amortization');
          expect(detail.amortization).toBeCloseTo(10_000, 0);
          state = nextState;
        }

        // Prestacao deve ser estritamente decrescente
        for (let i = 1; i < payments.length; i++) {
          expect(payments[i]).toBeLessThan(payments[i - 1]);
        }

        expect(state.outstandingBalance).toBeCloseTo(0, 2);
      });

      it('should reach paid_off after full term', () => {
        // Apos 12 meses de amortizacao de R$10.000 cada:
        //   saldo = 120.000 - 12 * 10.000 = R$0
        // No mes 13 (indice 12), getPhase() retorna 'paid_off'
        // e nenhum pagamento e gerado.
        let state = initFinancingState(sacFinancing);
        for (let i = 0; i < 12; i++) {
          const { nextState } = computeFinancingMonth(
            sacFinancing,
            state,
            i,
            0,
          );
          state = nextState;
        }
        const { detail } = computeFinancingMonth(sacFinancing, state, 12, 0);
        expect(detail.phase).toBe('paid_off');
        expect(detail.payment).toBe(0);
      });
    });

    describe('PRICE', () => {
      it('should produce constant payments over full term', () => {
        // Todas as 12 prestacoes devem ser iguais (~R$10.661,85).
        // Internamente, a cada mes:
        //   juros = saldo * 0.01 (cai conforme saldo diminui)
        //   amortizacao = PMT - juros (cresce conforme juros caem)
        //
        // Exemplo:
        //   Mes 0:  juros = 120k * 0.01 = 1200, amort = 10662 - 1200 = 9462
        //   Mes 1:  saldo = 110538, juros = 1105, amort = 9557
        //   Mes 11: saldo = ~10556, juros = ~106, amort = ~10556
        //
        // Ao final: saldo = R$0
        let state = initFinancingState(priceFinancing);
        const payments: number[] = [];

        for (let i = 0; i < 12; i++) {
          const { detail, nextState } = computeFinancingMonth(
            priceFinancing,
            state,
            i,
            0,
          );
          payments.push(detail.payment);
          state = nextState;
        }

        for (let i = 1; i < payments.length; i++) {
          expect(payments[i]).toBeCloseTo(payments[0], 2);
        }

        expect(state.outstandingBalance).toBeCloseTo(0, 2);
      });
    });

    describe('construction phase', () => {
      // R$1.200.000 a 11% a.a. (0.917% a.m.), prazo 420 meses, 16 meses de obra.
      //
      // Durante a obra (meses 0-15):
      //   - Nao ha amortizacao, saldo permanece R$1.200.000.
      //   - Banco libera 95% do principal linearmente ao longo de 16 meses.
      //   - liberado_por_mes = (1.200.000 * 0.95) / 16 = R$71.250
      //   - juros(m) = 71.250 * (m+1) * 0.0091667
      //
      // Apos a obra (mes 16+):
      //   - Amortizacao SAC comeca sobre o saldo total de R$1.200.000.
      //   - amort = 1.200.000 / 420 = R$2.857,14/mes
      const withConstruction: BoxFinancing = {
        principal: 1_200_000,
        annualRate: 0.11,
        termMonths: 420,
        system: 'sac',
        constructionMonths: 16,
      };

      it('should pay only interest during construction', () => {
        // Mes 0 (primeiro mes de obra):
        //   acumulado = 71.250 * 1 = R$71.250
        //   juros = 71.250 * 0.0091667 = R$653,13
        //   amortizacao = R$0 (nao amortiza durante obra)
        //   prestacao = R$653,13 (apenas juros)
        //   saldo = R$1.200.000 (inalterado)
        const state = initFinancingState(withConstruction);
        const { detail } = computeFinancingMonth(withConstruction, state, 0, 0);

        expect(detail.phase).toBe('construction');
        expect(detail.amortization).toBe(0);
        expect(detail.interest).toBeGreaterThan(0);
        expect(detail.payment).toBe(detail.interest);
        expect(detail.outstandingBalance).toBe(1_200_000);
      });

      it('should transition to amortization after construction', () => {
        // Meses 0-15: todos em fase 'construction' (juros de obra crescentes).
        //   Mes 0:  juros = 71.250 * 0.00917 = R$653
        //   Mes 15: juros = 71.250 * 16 * 0.00917 = 1.140.000 * 0.00917 = R$10.450
        //
        // Mes 16: primeira parcela de amortizacao.
        //   amort = 1.200.000 / 420 = R$2.857,14
        //   juros = 1.200.000 * 0.00917 = R$11.000
        //   prestacao = 2.857 + 11.000 = R$13.857
        let state = initFinancingState(withConstruction);
        for (let i = 0; i < 16; i++) {
          const { detail, nextState } = computeFinancingMonth(
            withConstruction,
            state,
            i,
            0,
          );
          expect(detail.phase).toBe('construction');
          state = nextState;
        }

        const { detail } = computeFinancingMonth(
          withConstruction,
          state,
          16,
          0,
        );
        expect(detail.phase).toBe('amortization');
        expect(detail.amortization).toBeGreaterThan(0);
      });
    });

    describe('grace period', () => {
      // R$50.000 a 6,5% a.a. (~0.5417% a.m.), prazo 168 meses, 18 meses de carencia.
      //
      // Durante carencia (meses 0-17):
      //   - Juros sobre o saldo total (sem amortizacao).
      //   - juros_mensal = 50.000 * (0.065/12) = 50.000 * 0.005417 = R$270,83
      //   - Saldo permanece R$50.000.
      //
      // Apos carencia (mes 18+):
      //   - Amortizacao SAC comeca: amort = 50.000 / 168 = R$297,62/mes
      const withGrace: BoxFinancing = {
        principal: 50_000,
        annualRate: 0.065,
        termMonths: 168,
        system: 'sac',
        gracePeriodMonths: 18,
      };

      it('should pay interest-only during grace', () => {
        // Mes 0 (carencia):
        //   juros = 50.000 * (0.065/12) = R$270,83
        //   amortizacao = R$0
        //   prestacao = R$270,83
        //   saldo = R$50.000 (inalterado)
        const state = initFinancingState(withGrace);
        const { detail } = computeFinancingMonth(withGrace, state, 0, 0);

        expect(detail.phase).toBe('grace');
        expect(detail.amortization).toBe(0);
        expect(detail.interest).toBeCloseTo(50_000 * (0.065 / 12), 2);
        expect(detail.outstandingBalance).toBe(50_000);
      });

      it('should transition to amortization after grace', () => {
        // Meses 0-17: todos em carencia (juros = R$270,83, saldo = R$50.000).
        // Mes 18: primeira parcela de amortizacao SAC.
        //   amort = 50.000 / 168 = R$297,62
        //   juros = 50.000 * 0.005417 = R$270,83
        //   prestacao = 297,62 + 270,83 = R$568,45
        let state = initFinancingState(withGrace);
        for (let i = 0; i < 18; i++) {
          const { nextState } = computeFinancingMonth(withGrace, state, i, 0);
          state = nextState;
        }
        const { detail } = computeFinancingMonth(withGrace, state, 18, 0);
        expect(detail.phase).toBe('amortization');
        expect(detail.amortization).toBeGreaterThan(0);
      });
    });

    describe('construction + grace', () => {
      // R$1.200.000 a 11% a.a., prazo 420 meses, 16 meses de obra + 6 meses de carencia.
      //
      // Maquina de estados de fases (derivada do indice do mes):
      //   Meses  0-15: construction (juros de obra, liberacao linear)
      //   Meses 16-21: grace (juros sobre saldo total, sem amortizacao)
      //   Meses 22+:   amortization (SAC regular sobre R$1.200.000)
      //
      // Transicao de juros:
      //   Ultimo mes obra (15): juros = 1.140.000 * 0.00917 = R$10.450
      //   Primeiro mes carencia (16): juros = 1.200.000 * 0.00917 = R$11.000
      //   Primeiro mes amort (22): amort = 1.200.000/420 = R$2.857 + juros = R$11.000
      const withBoth: BoxFinancing = {
        principal: 1_200_000,
        annualRate: 0.11,
        termMonths: 420,
        system: 'sac',
        constructionMonths: 16,
        gracePeriodMonths: 6,
      };

      it('should transition construction -> grace -> amortization', () => {
        let state = initFinancingState(withBoth);

        // Construction: meses 0-15
        for (let i = 0; i < 16; i++) {
          const { detail, nextState } = computeFinancingMonth(
            withBoth,
            state,
            i,
            0,
          );
          expect(detail.phase).toBe('construction');
          state = nextState;
        }

        // Grace: meses 16-21
        for (let i = 16; i < 22; i++) {
          const { detail, nextState } = computeFinancingMonth(
            withBoth,
            state,
            i,
            0,
          );
          expect(detail.phase).toBe('grace');
          state = nextState;
        }

        // Amortization: mes 22+
        const { detail } = computeFinancingMonth(withBoth, state, 22, 0);
        expect(detail.phase).toBe('amortization');
      });
    });

    describe('extra amortization', () => {
      it('should reduce outstanding balance and recalculate installment', () => {
        // SAC R$120.000 a 1% a.m. em 12 meses.
        //
        // Mes 0 (normal):
        //   amort = 120.000 / 12 = R$10.000
        //   juros = 120.000 * 0.01 = R$1.200
        //   prestacao = R$11.200
        //   saldo apos = 120.000 - 10.000 = R$110.000
        //
        // Mes 1 (com extra de R$60.000):
        //   Extra aplicado antes da parcela regular:
        //     saldo = 110.000 - 60.000 = R$50.000
        //   SAC recalculado sobre R$50.000 com 11 parcelas restantes:
        //     amort = 50.000 / 11 = R$4.545,45
        //     juros = 50.000 * 0.01 = R$500,00
        //     prestacao = 4.545 + 500 = R$5.045,45
        //   saldo apos = 50.000 - 4.545 = R$45.454,55
        //
        // Verificacoes:
        //   d1.outstandingBalance = 120k - 10k(m0) - 60k(extra) - 4.545(m1) = ~45.455
        //   d1.payment (5.045) < d0.payment (11.200) porque saldo caiu muito
        const state = initFinancingState(sacFinancing);

        const { detail: d0, nextState: s1 } = computeFinancingMonth(
          sacFinancing,
          state,
          0,
          0,
        );

        const { detail: d1 } = computeFinancingMonth(
          sacFinancing,
          s1,
          1,
          60_000,
        );

        expect(d1.outstandingBalance).toBeCloseTo(
          sacFinancing.principal - d0.amortization - 60_000 - d1.amortization,
          2,
        );
        expect(d1.payment).toBeLessThan(d0.payment);
      });

      it('should pay off early with large extra amortization', () => {
        // SAC R$120.000 a 1% a.m. em 12 meses.
        // Extra de R$200.000 no mes 0:
        //   saldo = 120.000 - 200.000 = clamped a R$0 (Math.max(0, ...))
        //   getPhase() retorna 'paid_off' pois saldo <= 0
        //   prestacao = R$0, amort = R$0, juros = R$0
        const state = initFinancingState(sacFinancing);
        const { detail } = computeFinancingMonth(
          sacFinancing,
          state,
          0,
          200_000,
        );
        expect(detail.phase).toBe('paid_off');
        expect(detail.payment).toBe(0);
      });
    });
  });
});
