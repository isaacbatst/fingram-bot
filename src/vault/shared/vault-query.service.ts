import { Injectable } from '@nestjs/common';
import { BoxRepository } from '@/vault/repositories/box.repository';
import { TransactionRepository } from '@/vault/repositories/transaction.repository';
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

    for (const period of periods) {
      const txs = await this.transactionRepo.findCommittedByPeriod(
        vaultId,
        period.startDate,
        period.endDate,
      );

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

      // Income = income - income in linked estratos
      const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
      const linkedIncome = incomes
        .filter((t) => t.boxId && linkedEstratoIds.has(t.boxId))
        .reduce((sum, t) => sum + t.amount, 0);
      const realIncome = totalIncome - linkedIncome;

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
      });
    }

    return result;
  }
}
