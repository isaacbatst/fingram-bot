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
        salary: number;
        monthlyCost: number;
        monthlyInvestment?: number;
      };
      fundAllocation: {
        fundId: string;
        label: string;
        target: number;
        priority: number;
      }[];
    },
  ) {
    if (!data.name?.trim()) {
      throw new BadRequestException('Nome do plano e obrigatorio');
    }

    if (!data.startDate) {
      throw new BadRequestException('Data de inicio e obrigatoria');
    }

    if (!data.premises) {
      throw new BadRequestException('Premissas sao obrigatorias');
    }

    if (typeof data.premises.salary !== 'number') {
      throw new BadRequestException('Salario e obrigatorio');
    }

    if (typeof data.premises.monthlyCost !== 'number') {
      throw new BadRequestException('Custo mensal e obrigatorio');
    }

    if (!Array.isArray(data.fundAllocation)) {
      throw new BadRequestException('Alocacao de fundos e obrigatoria');
    }

    for (const fund of data.fundAllocation) {
      if (!fund.fundId || !fund.label || typeof fund.priority !== 'number') {
        throw new BadRequestException(
          'Cada fundo deve ter fundId, label, target e priority',
        );
      }
      if (typeof fund.target !== 'number' || fund.target < 0) {
        throw new BadRequestException(
          'Target do fundo deve ser um numero >= 0',
        );
      }
    }

    const [error, plan] = await this.planService.create({
      vaultId,
      name: data.name,
      startDate: new Date(data.startDate),
      premises: data.premises,
      fundAllocation: data.fundAllocation,
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
      throw new BadRequestException('Numero de meses deve ser entre 1 e 600');
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
