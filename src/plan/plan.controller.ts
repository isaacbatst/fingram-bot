import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
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
      milestones?: {
        month: number;
        label: string;
        type: MilestoneType;
      }[];
      allocations?: {
        label: string;
        target: number;
        monthlyAmount: { month: number; amount: number }[];
        holdsFunds: boolean;
        yieldRate?: number;
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
        scheduledMovements: {
          month: number;
          amount: number;
          label: string;
          type: 'in' | 'out';
          destinationBoxId?: string;
          additionalToMonthly?: boolean;
        }[];
        initialBalance?: number;
      }[];
    },
  ) {
    if (!data.startDate) {
      throw new BadRequestException('Data de início é obrigatória');
    }

    if (!data.premises) {
      throw new BadRequestException('Premissas são obrigatórias');
    }

    const [error, result] = await this.planService.create({
      vaultId,
      name: data.name,
      startDate: new Date(data.startDate),
      premises: data.premises,
      milestones: data.milestones,
      allocations: data.allocations,
    });

    if (error !== null) {
      throw new BadRequestException(error);
    }

    return {
      ...result.plan.toJSON(),
      allocations: result.allocations,
    };
  }

  @Get(':id')
  async getById(@VaultSession() vaultId: string, @Param('id') id: string) {
    const [error, result] = await this.planService.getById(id, vaultId);

    if (error !== null) {
      throw new NotFoundException(error);
    }

    return {
      ...result.plan.toJSON(),
      allocations: result.allocations,
    };
  }

  @Delete(':id')
  async delete(@VaultSession() vaultId: string, @Param('id') id: string) {
    const [error] = await this.planService.delete(id, vaultId);

    if (error !== null) {
      throw new NotFoundException(error);
    }

    return { success: true };
  }

  @Patch(':planId/allocations/:allocationId')
  async bindAllocation(
    @VaultSession() vaultId: string,
    @Param('planId') planId: string,
    @Param('allocationId') allocationId: string,
    @Body() body: { estratoId: string | null },
  ) {
    const [error, allocation] = await this.planService.bindAllocationToEstrato(
      allocationId,
      body.estratoId,
      vaultId,
    );
    if (error) throw new BadRequestException(error);
    return allocation;
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
