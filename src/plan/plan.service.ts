import { Injectable, Logger } from '@nestjs/common';
import { Either, left, right } from '@/vault/domain/either';
import { Plan, Milestone, MonthData, Premises, RealMonthData } from './domain/plan';
import { Allocation } from './shared/domain/allocation';
import { runProjection } from './domain/run-projection';
import { PlanRepository } from './repositories/plan.repository';
import { AllocationRepository } from './shared/repositories/allocation.repository';
import { PlanQueryService } from './shared/plan-query.service';
import {
  VaultQueryService,
  PeriodRange,
} from '@/vault/shared/vault-query.service';
import { ChangePoint } from './domain/change-point';
import {
  AllocationFinancing,
  AllocationScheduledMovement,
  RealizationMode,
} from './shared/domain/allocation';

interface CreateAllocationInput {
  label: string;
  target: number;
  monthlyAmount: ChangePoint[];
  realizationMode: RealizationMode;
  yieldRate?: number;
  financing?: AllocationFinancing;
  scheduledMovements: AllocationScheduledMovement[];
  initialBalance?: number;
}

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    private readonly planRepository: PlanRepository,
    private readonly allocationRepo: AllocationRepository,
    private readonly planQuery: PlanQueryService,
    private readonly vaultQuery: VaultQueryService,
  ) {}

  async create(input: {
    vaultId: string;
    name: string;
    startDate: Date;
    premises: Premises;
    allocations?: CreateAllocationInput[];
    milestones?: Milestone[];
  }): Promise<Either<string, { plan: Plan; allocations: Allocation[] }>> {
    this.logger.log(`Creating plan for vault: ${input.vaultId}`);

    if (!input.name?.trim()) {
      return left('Nome do plano é obrigatório');
    }

    if (!input.premises.salaryChangePoints?.length) {
      return left(
        'Premissas devem ter pelo menos um change point de salário',
      );
    }

    if (!input.premises.costOfLivingChangePoints?.length) {
      return left(
        'Premissas devem ter pelo menos um change point de custo de vida',
      );
    }

    for (const cp of input.premises.salaryChangePoints) {
      if (cp.amount < 0) {
        return left(
          'Valor do change point de salário não pode ser negativo',
        );
      }
      if (cp.month < 0) {
        return left('Mês do change point não pode ser negativo');
      }
    }

    for (const cp of input.premises.costOfLivingChangePoints) {
      if (cp.amount < 0) {
        return left(
          'Valor do change point de custo de vida não pode ser negativo',
        );
      }
      if (cp.month < 0) {
        return left('Mês do change point não pode ser negativo');
      }
    }

    for (const alloc of input.allocations ?? []) {
      if (!alloc.label?.trim()) {
        return left('Label da alocação é obrigatória');
      }
      if (alloc.target < 0) {
        return left('Target da alocação não pode ser negativo');
      }
      if (alloc.yieldRate !== undefined && alloc.yieldRate < 0) {
        return left('Taxa de rendimento não pode ser negativa');
      }
      if (alloc.yieldRate !== undefined && alloc.realizationMode === 'immediate') {
        return left(
          'Taxa de rendimento só pode ser definida para alocações que retêm fundos',
        );
      }
      if (alloc.realizationMode === 'onCompletion' && (!alloc.target || alloc.target <= 0)) {
        return left('Modo onCompletion requer target > 0');
      }
      if (alloc.realizationMode === 'immediate' && alloc.scheduledMovements?.some((m) => m.type === 'out')) {
        return left('Alocações immediate não suportam scheduled movements do tipo out');
      }
      if (alloc.financing) {
        if (alloc.realizationMode !== 'immediate') {
          return left(
            'Alocação com financiamento não pode reter fundos (realizationMode deve ser immediate)',
          );
        }
        if (alloc.financing.principal <= 0) {
          return left('Principal do financiamento deve ser maior que zero');
        }
        if (alloc.financing.annualRate <= 0) {
          return left(
            'Taxa de juros do financiamento deve ser maior que zero',
          );
        }
        if (
          alloc.financing.termMonths <= 0 ||
          !Number.isInteger(alloc.financing.termMonths)
        ) {
          return left('Prazo do financiamento deve ser um inteiro positivo');
        }
        if (
          alloc.financing.system !== 'sac' &&
          alloc.financing.system !== 'price'
        ) {
          return left('Sistema de amortização deve ser "sac" ou "price"');
        }
      }
    }

    const plan = Plan.create({
      vaultId: input.vaultId,
      name: input.name.trim(),
      startDate: input.startDate,
      premises: input.premises,
      milestones: input.milestones,
    });

    const allocations = (input.allocations ?? []).map((a) =>
      Allocation.create({ ...a, planId: plan.id }),
    );

    await this.planRepository.create(plan);
    if (allocations.length > 0) {
      await this.allocationRepo.createMany(allocations);
    }

    this.logger.log(`Plan created with id: ${plan.id}`);
    return right({ plan, allocations });
  }

  async getById(
    id: string,
    vaultId: string,
  ): Promise<Either<string, { plan: Plan; allocations: Allocation[] }>> {
    const plan = await this.planQuery.findPlanById(id);
    if (!plan || plan.vaultId !== vaultId) return left('Plano não encontrado');
    const allocations = await this.planQuery.listAllocationsByPlanId(id);
    return right({ plan, allocations });
  }

  async getProjection(
    id: string,
    vaultId: string,
    months: number = 120,
  ): Promise<Either<string, MonthData[]>> {
    const plan = await this.planQuery.findPlanById(id);
    if (!plan || plan.vaultId !== vaultId) return left('Plano não encontrado');
    const allocations = await this.planQuery.listAllocationsByPlanId(id);

    // Compute real data for past months
    const now = new Date();
    const startDate = plan.startDate;
    const monthsDiff =
      (now.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - startDate.getUTCMonth());
    const currentMonth = Math.max(0, monthsDiff);

    // Build periods for past months
    const periods: PeriodRange[] = [];
    for (let i = 0; i < currentMonth; i++) {
      const periodStart = new Date(
        Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i, 1),
      );
      const periodEnd = new Date(
        Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i + 1, 1),
      );
      periods.push({ month: i, startDate: periodStart, endDate: periodEnd });
    }

    const allocationContext = allocations.map((a) => ({
      allocationId: a.id,
      realizationMode: a.realizationMode,
      estratoId: a.estratoId,
    }));

    let realData: RealMonthData[] = [];
    if (periods.length > 0) {
      realData = await this.vaultQuery.aggregateByPeriod(
        vaultId,
        periods,
        allocationContext,
      );
    }

    return right(
      runProjection(
        plan.premises,
        allocations,
        plan.startDate,
        months,
        realData,
        currentMonth,
      ),
    );
  }

  async delete(id: string, vaultId: string): Promise<Either<string, true>> {
    const plan = await this.planQuery.findPlanById(id);
    if (!plan || plan.vaultId !== vaultId) return left('Plano não encontrado');
    await this.planRepository.delete(id);
    return right(true);
  }

  async getByVaultId(vaultId: string): Promise<Plan[]> {
    return this.planQuery.listPlansByVaultId(vaultId);
  }

  async bindAllocationToEstrato(
    allocationId: string,
    estratoId: string | null,
    vaultId: string,
  ): Promise<Either<string, Allocation>> {
    const allocation = await this.planQuery.findAllocationById(allocationId);
    if (!allocation) return left('Alocação não encontrada');

    const plan = await this.planQuery.findPlanById(allocation.planId);
    if (!plan || plan.vaultId !== vaultId) return left('Alocação não pertence a este vault');

    if (estratoId === null) {
      allocation.unbindEstrato();
      await this.allocationRepo.update(allocation);
      return right(allocation);
    }

    const box = await this.vaultQuery.findBoxById(estratoId);
    if (!box) return left('Estrato não encontrado');
    if (box.vaultId !== vaultId) return left('Estrato não pertence a este vault');
    if (box.type !== 'saving') return left('Só estratos do tipo saving podem ser vinculados');

    const [bindError] = allocation.bindToEstrato(estratoId);
    if (bindError) return left(bindError);

    await this.allocationRepo.update(allocation);
    return right(allocation);
  }
}
