import {
  Body,
  Controller,
  InternalServerErrorException,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { VaultAgentService } from './vault-agent.service';
import { VaultSession } from './vault-session.decorator';
import { VaultAccessTokenGuard } from './vault-access-token.guard';

@Controller('vault')
export class VaultAgentController {
  private readonly logger = new Logger(VaultAgentController.name);
  constructor(private readonly vaultAgentService: VaultAgentService) {}

  @UseGuards(VaultAccessTokenGuard)
  @Post('agent')
  async agent(@Body() data: any, @VaultSession() vaultId: string) {
    const [error, result] = await this.vaultAgentService.execute({
      ...data,
      vaultId,
    });
    if (error) {
      this.logger.error(`Error executing agent ${error}`);
      throw new InternalServerErrorException(error);
    }
    return result;
  }
}
