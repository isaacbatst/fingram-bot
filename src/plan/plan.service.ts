import { Injectable, Logger } from '@nestjs/common';
import { Either, left, right } from '@/vault/domain/either';
import {
  Plan,
  FundRule,
  MonthData,
  Premises,
  Phase,
  Milestone,
} from './domain/plan';
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
    phases: Phase[];
    milestones?: Milestone[];
    fundAllocation: FundRule[];
  }): Promise<Either<string, Plan>> {
    this.logger.log(`Creating plan for vault: ${input.vaultId}`);

    if (!input.name?.trim()) {
      return left('Nome do plano e obrigatorio');
    }

    if (input.premises.salary < 0) {
      return left('Salario nao pode ser negativo');
    }

    if (
      input.premises.monthlyInvestment !== undefined &&
      input.premises.monthlyInvestment < 0
    ) {
      return left('Investimento mensal nao pode ser negativo');
    }

    if (!input.phases || input.phases.length === 0) {
      return left('Plano deve ter pelo menos uma fase');
    }

    for (const phase of input.phases) {
      if (phase.monthlyCost < 0) {
        return left('Custo mensal da fase nao pode ser negativo');
      }
      if (phase.startMonth > phase.endMonth) {
        return left('Mes inicial da fase deve ser menor ou igual ao mes final');
      }
    }

    const plan = Plan.create({
      vaultId: input.vaultId,
      name: input.name.trim(),
      startDate: input.startDate,
      premises: input.premises,
      phases: input.phases,
      milestones: input.milestones,
      fundAllocation: input.fundAllocation,
    });

    await this.planRepository.create(plan);
    this.logger.log(`Plan created with id: ${plan.id}`);
    return right(plan);
  }

  async getById(id: string, vaultId: string): Promise<Either<string, Plan>> {
    this.logger.log(`Getting plan: ${id}`);
    const plan = await this.planRepository.findById(id);
    if (!plan) {
      return left('Plano nao encontrado');
    }
    if (plan.vaultId !== vaultId) {
      return left('Plano nao encontrado');
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
      return left('Plano nao encontrado');
    }
    if (plan.vaultId !== vaultId) {
      return left('Plano nao encontrado');
    }
    const projection = runProjection(plan, months);
    return right(projection);
  }

  async delete(id: string, vaultId: string): Promise<Either<string, true>> {
    this.logger.log(`Deleting plan: ${id}`);
    const plan = await this.planRepository.findById(id);
    if (!plan || plan.vaultId !== vaultId) {
      return left('Plano nao encontrado');
    }
    await this.planRepository.delete(id);
    return right(true);
  }

  async getByVaultId(vaultId: string): Promise<Plan[]> {
    return this.planRepository.findByVaultId(vaultId);
  }
}
