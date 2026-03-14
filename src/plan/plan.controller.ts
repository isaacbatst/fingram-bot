import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { VaultAccessTokenGuard } from '@/vault/vault-access-token.guard';
import { VaultSession } from '@/vault/vault-session.decorator';
import { MilestoneType } from './domain/plan';
import { PlanService } from './plan.service';

@Controller('plans')
@UseGuards(VaultAccessTokenGuard)
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Get()
  async list(@VaultSession() vaultId: string) {
    const plans = await this.planService.getByVaultId(vaultId);
    return plans.map((p) => p.toJSON());
  }

  @Post()
  async create(
    @VaultSession() vaultId: string,
    @Body()
    data: {
      name: string;
      startDate: string;
      premises: {
        salaryChangePoints: { month: number; amount: number }[];
        costOfLivingChangePoints: { month: number; amount: number }[];
      };
      boxes: {
        id?: string;
        label: string;
        target: number;
        monthlyAmount: { month: number; amount: number }[];
        holdsFunds: boolean;
        yieldRate?: number;
        initialBalance?: number;
        financing?: {
          principal: number;
          annualRate: number;
          termMonths: number;
          system: 'sac' | 'price';
          constructionMonths?: number;
          gracePeriodMonths?: number;
          releasePercent?: number;
          startMonth?: number;
        };
        scheduledPayments: {
          month: number;
          amount: number;
          label: string;
          additionalToMonthly?: boolean;
          sourceBoxId?: string;
        }[];
      }[];
      milestones?: {
        month: number;
        label: string;
        type: MilestoneType;
      }[];
    },
  ) {
    if (!data.startDate) {
      throw new BadRequestException('Data de início é obrigatória');
    }

    if (!data.premises) {
      throw new BadRequestException('Premissas são obrigatórias');
    }

    const [error, plan] = await this.planService.create({
      vaultId,
      name: data.name,
      startDate: new Date(data.startDate),
      premises: data.premises,
      boxes: (data.boxes ?? []).map((b) => ({
        id: b.id || '',
        label: b.label,
        target: b.target,
        monthlyAmount: b.monthlyAmount ?? [],
        holdsFunds: b.holdsFunds ?? true,
        yieldRate: b.yieldRate,
        initialBalance: b.initialBalance,
        financing: b.financing,
        scheduledPayments: b.scheduledPayments ?? [],
      })),
      milestones: data.milestones,
    });

    if (error !== null) {
      throw new BadRequestException(error);
    }

    return plan.toJSON();
  }

  @Get(':id')
  async getById(@VaultSession() vaultId: string, @Param('id') id: string) {
    const [error, plan] = await this.planService.getById(id, vaultId);

    if (error !== null) {
      throw new NotFoundException(error);
    }

    return plan.toJSON();
  }

  @Delete(':id')
  async delete(@VaultSession() vaultId: string, @Param('id') id: string) {
    const [error] = await this.planService.delete(id, vaultId);

    if (error !== null) {
      throw new NotFoundException(error);
    }

    return { success: true };
  }

  @Get(':id/projection')
  async getProjection(
    @VaultSession() vaultId: string,
    @Param('id') id: string,
    @Query('months') monthsParam?: string,
  ) {
    const months = monthsParam ? parseInt(monthsParam, 10) : 120;

    if (isNaN(months) || months < 1 || months > 600) {
      throw new BadRequestException('Número de meses deve ser entre 1 e 600');
    }

    const [error, projection] = await this.planService.getProjection(
      id,
      vaultId,
      months,
    );

    if (error !== null) {
      throw new NotFoundException(error);
    }

    return projection;
  }
}
