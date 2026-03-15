import { Injectable, Logger } from '@nestjs/common';
import { Either, left, right } from '@/vault/domain/either';
import { Plan, Milestone, MonthData, Premises } from './domain/plan';
import { Allocation } from './shared/domain/allocation';
import { runProjection } from './domain/run-projection';
import { PlanRepository } from './repositories/plan.repository';
import { AllocationRepository } from './shared/repositories/allocation.repository';
import { PlanQueryService } from './shared/plan-query.service';
import { VaultQueryService } from '@/vault/shared/vault-query.service';
import { ChangePoint } from './domain/change-point';
import {
  AllocationFinancing,
  AllocationScheduledMovement,
} from './shared/domain/allocation';

interface CreateAllocationInput {
  label: string;
  target: number;
  monthlyAmount: ChangePoint[];
  holdsFunds: boolean;
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
    return right(
      runProjection(plan.premises, allocations, plan.startDate, months),
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
