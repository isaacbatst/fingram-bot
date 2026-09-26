import { Injectable } from '@nestjs/common';
import { BoxRepository } from '@/vault/repositories/box.repository';
import {
  AggregationTransaction,
  DailyActivity,
  TransactionRepository,
} from '@/vault/repositories/transaction.repository';
import { BoxInfo } from './domain/box-info';
import { RealMonthData } from '@/plan/domain/plan';
import { RealizationMode } from '@/plan/shared/domain/allocation';

export interface AllocationContext {
  allocationId: string;
  realizationMode: RealizationMode;
  estratoId: string | null;
}

export interface PeriodRange {
  month: number;
  startDate: Date;
  endDate: Date;
}

@Injectable()
export class VaultQueryService {
  constructor(
    private readonly boxRepo: BoxRepository,
    private readonly transactionRepo: TransactionRepository,
  ) {}

  /**
   * Atividade diária das últimas `weeks` semanas, para o grid da tela inicial.
   *
   * A janela começa num domingo para que cada coluna do grid seja uma semana
   * inteira, e vai até o fim de hoje. Todo o cálculo é em UTC: as datas são
   * gravadas como meia-noite UTC e usar métodos locais em UTC-3 jogaria cada
   * lançamento para o dia anterior.
   */
  async getDailyActivity(
    vaultId: string,
    weeks = 20,
  ): Promise<{ startDate: Date; endDate: Date; days: DailyActivity[] }> {
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - (weeks * 7 - 1));
    // Recua até o domingo daquela semana.
    startDate.setUTCDate(startDate.getUTCDate() - startDate.getUTCDay());

    // Exclusivo: inclui tudo que caiu hoje.
    const endDate = new Date(today);
    endDate.setUTCDate(endDate.getUTCDate() + 1);

    const days = await this.transactionRepo.countByDay(
      vaultId,
      startDate,
      endDate,
    );
    return { startDate, endDate, days };
  }

  async findBoxById(boxId: string): Promise<BoxInfo | null> {
    const box = await this.boxRepo.findById(boxId);
    if (!box) return null;
    return {
      id: box.id,
      name: box.name,
      type: box.type,
      balance: 0, // balance computation deferred to later slice
      goalAmount: box.goalAmount,
      vaultId: box.vaultId,
    };
  }

  async listSavingBoxes(vaultId: string): Promise<BoxInfo[]> {
    const boxes = await this.boxRepo.findByVaultId(vaultId);
    return boxes
      .filter((b) => b.type === 'saving')
      .map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        balance: 0,
        goalAmount: b.goalAmount,
        vaultId: b.vaultId,
      }));
  }

  async aggregateByPeriod(
    vaultId: string,
    periods: PeriodRange[],
    allocationContext: AllocationContext[],
  ): Promise<RealMonthData[]> {
    const linkedEstratoIds = new Set(
      allocationContext.filter((a) => a.estratoId).map((a) => a.estratoId!),
    );

    const result: RealMonthData[] = [];

    // Estrato balances at the start of each period: everything before the
    // first period, then rolled forward with each period's transactions.
    // Periods are consecutive and in order (plan months).
    const balances: Record<string, number> = {};
    const addToBalances = (txs: AggregationTransaction[]) => {
      for (const t of txs) {
        if (!t.boxId) continue;
        balances[t.boxId] =
          (balances[t.boxId] ?? 0) +
          (t.type === 'income' ? t.amount : -t.amount);
      }
    };
    if (periods.length > 0) {
      addToBalances(
        await this.transactionRepo.findCommittedByPeriod(
          vaultId,
          new Date(0),
          periods[0].startDate,
        ),
      );
    }

    for (const period of periods) {
      const openingBalances = { ...balances };
      const txs = await this.transactionRepo.findCommittedByPeriod(
        vaultId,
        period.startDate,
        period.endDate,
      );
      addToBalances(txs);

      const expenses = txs.filter((t) => t.type === 'expense');
      const incomes = txs.filter((t) => t.type === 'income');

      // Cost of living = expenses - tagged expenses - transfer expenses
      const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);
      const taggedExpenses = expenses
        .filter((t) => t.allocationId)
        .reduce((sum, t) => sum + t.amount, 0);
      const transferExpenses = expenses
        .filter((t) => t.transferId)
        .reduce((sum, t) => sum + t.amount, 0);
      const realCostOfLiving =
        totalExpenses - taggedExpenses - transferExpenses;

      // Income = income - income in linked estratos - incoming side of
      // transfers. A transfer is money moving between the user's own estratos,
      // not money earned (the same reason its expense side is left out of the
      // cost of living above).
      const realIncome = incomes
        .filter(
          (t) => !t.transferId && !(t.boxId && linkedEstratoIds.has(t.boxId)),
        )
        .reduce((sum, t) => sum + t.amount, 0);

      // Allocation payments
      const allocationPayments = allocationContext.map((ctx) => {
        if (ctx.realizationMode === 'immediate') {
          // Pagamento: sum expenses tagged with this allocationId
          const amount = expenses
            .filter((t) => t.allocationId === ctx.allocationId)
            .reduce((sum, t) => sum + t.amount, 0);
          return { allocationId: ctx.allocationId, amount };
        } else {
          // Reserva: sum transfers INTO the linked estrato
          if (!ctx.estratoId)
            return { allocationId: ctx.allocationId, amount: 0 };
          const amount = incomes
            .filter((t) => t.boxId === ctx.estratoId && t.transferId)
            .reduce((sum, t) => sum + t.amount, 0);
          return { allocationId: ctx.allocationId, amount };
        }
      });

      // Realization aggregation for manual/onCompletion allocations (hybrid projection)
      const allocationRealizations = allocationContext
        .filter((ctx) => ctx.realizationMode !== 'immediate')
        .map((ctx) => {
          const amount = expenses
            .filter(
              (t) =>
                t.allocationId === ctx.allocationId &&
                t.withdrawalType === 'realization',
            )
            .reduce((sum, t) => sum + t.amount, 0);
          return { allocationId: ctx.allocationId, amount };
        });

      result.push({
        month: period.month,
        realIncome,
        realCostOfLiving,
        allocationPayments,
        allocationRealizations,
        openingBalances,
      });
    }

    return result;
  }
}
