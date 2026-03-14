import { Injectable, Logger } from '@nestjs/common';
import { Either, left, right } from '@/vault/domain/either';
import { Plan, Box, Milestone, MonthData, Premises } from './domain/plan';
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
    boxes: Box[];
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

    for (const box of input.boxes) {
      if (!box.label?.trim()) {
        return left('Label da box é obrigatória');
      }
      if (box.target < 0) {
        return left('Target da box não pode ser negativo');
      }
      if (box.yieldRate !== undefined && box.yieldRate < 0) {
        return left('Taxa de rendimento não pode ser negativa');
      }
      if (box.yieldRate !== undefined && !box.holdsFunds) {
        return left(
          'Taxa de rendimento só pode ser definida para boxes que retêm fundos',
        );
      }
      for (const cp of box.monthlyAmount) {
        if (cp.amount < 0) {
          return left(
            'Valor do change point de aporte mensal não pode ser negativo',
          );
        }
        if (cp.month < 0) {
          return left('Mês do change point não pode ser negativo');
        }
      }
      for (const sp of box.scheduledPayments) {
        if (sp.amount <= 0) {
          return left('Valor do pagamento agendado deve ser maior que zero');
        }
        if (sp.month < 0) {
          return left('Mês do pagamento agendado não pode ser negativo');
        }
        if (!sp.label?.trim()) {
          return left('Label do pagamento agendado é obrigatória');
        }
        if (
          sp.sourceBoxId &&
          !input.boxes.some((b) => b.id === sp.sourceBoxId)
        ) {
          return left('sourceBoxId referencia uma box que não existe no plano');
        }
      }

      if (box.financing) {
        if (box.holdsFunds) {
          return left(
            'Box com financiamento não pode reter fundos (holdsFunds deve ser false)',
          );
        }
        if (box.yieldRate !== undefined) {
          return left('Box com financiamento não pode ter taxa de rendimento');
        }
        if (box.financing.principal <= 0) {
          return left('Principal do financiamento deve ser maior que zero');
        }
        if (box.financing.annualRate <= 0) {
          return left('Taxa de juros do financiamento deve ser maior que zero');
        }
        if (
          box.financing.termMonths <= 0 ||
          !Number.isInteger(box.financing.termMonths)
        ) {
          return left('Prazo do financiamento deve ser um inteiro positivo');
        }
        if (
          box.financing.system !== 'sac' &&
          box.financing.system !== 'price'
        ) {
          return left('Sistema de amortização deve ser "sac" ou "price"');
        }
        if (
          box.financing.constructionMonths !== undefined &&
          box.financing.constructionMonths < 0
        ) {
          return left('Meses de obra não podem ser negativos');
        }
        if (
          box.financing.gracePeriodMonths !== undefined &&
          box.financing.gracePeriodMonths < 0
        ) {
          return left('Meses de carência não podem ser negativos');
        }
        if (
          box.financing.releasePercent !== undefined &&
          (box.financing.releasePercent <= 0 ||
            box.financing.releasePercent > 1)
        ) {
          return left(
            'Percentual de liberação deve ser entre 0 (exclusivo) e 1 (inclusivo)',
          );
        }
      }
    }

    const plan = Plan.create({
      vaultId: input.vaultId,
      name: input.name.trim(),
      startDate: input.startDate,
      premises: input.premises,
      boxes: input.boxes,
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
    const projection = runProjection(plan, months);
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
