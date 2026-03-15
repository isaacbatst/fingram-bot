import { Injectable, Logger } from '@nestjs/common';
import { Either, left, right } from '@/vault/domain/either';
import { Plan, Milestone, MonthData, Premises } from './domain/plan';
import { runProjection } from './domain/run-projection';
import { PlanRepository } from './repositories/plan.repository';

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(private readonly planRepository: PlanRepository) {}

  async create(input: {
    vaultId: string;
    name: string;
    startDate: Date;
    premises: Premises;
    milestones?: Milestone[];
  }): Promise<Either<string, Plan>> {
    this.logger.log(`Creating plan for vault: ${input.vaultId}`);

    if (!input.name?.trim()) {
      return left('Nome do plano é obrigatório');
    }

    if (
      !input.premises.salaryChangePoints ||
      input.premises.salaryChangePoints.length === 0
    ) {
      return left('Premissas devem ter pelo menos um change point de salário');
    }

    if (
      !input.premises.costOfLivingChangePoints ||
      input.premises.costOfLivingChangePoints.length === 0
    ) {
      return left(
        'Premissas devem ter pelo menos um change point de custo de vida',
      );
    }

    for (const cp of input.premises.salaryChangePoints) {
      if (cp.amount < 0) {
        return left('Valor do change point de salário não pode ser negativo');
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

    await this.planRepository.create(plan);
    this.logger.log(`Plan created with id: ${plan.id}`);
    return right(plan);
  }

  async getById(id: string, vaultId: string): Promise<Either<string, Plan>> {
    this.logger.log(`Getting plan: ${id}`);
    const plan = await this.planRepository.findById(id);
    if (!plan) {
      return left('Plano não encontrado');
    }
    if (plan.vaultId !== vaultId) {
      return left('Plano não encontrado');
    }
    return right(plan);
  }

  async getProjection(
    id: string,
    vaultId: string,
    months: number = 120,
  ): Promise<Either<string, MonthData[]>> {
    this.logger.log(`Getting projection for plan: ${id}, months: ${months}`);
    const plan = await this.planRepository.findById(id);
    if (!plan) {
      return left('Plano não encontrado');
    }
    if (plan.vaultId !== vaultId) {
      return left('Plano não encontrado');
    }
    // TODO: Task 7 will rewire this to load allocations from AllocationRepository
    const projection = runProjection(plan.premises, [], plan.startDate, months);
    return right(projection);
  }

  async delete(id: string, vaultId: string): Promise<Either<string, true>> {
    this.logger.log(`Deleting plan: ${id}`);
    const plan = await this.planRepository.findById(id);
    if (!plan || plan.vaultId !== vaultId) {
      return left('Plano não encontrado');
    }
    await this.planRepository.delete(id);
    return right(true);
  }

  async getByVaultId(vaultId: string): Promise<Plan[]> {
    return this.planRepository.findByVaultId(vaultId);
  }
}
