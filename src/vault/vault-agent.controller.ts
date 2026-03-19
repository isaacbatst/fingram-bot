import {
  Body,
  Controller,
  InternalServerErrorException,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
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
      message: data.message,
      decisions: data.decisions ?? {},
      conversationId: data.conversationId ?? '',
      vaultId,
    });
    if (error) {
      this.logger.error(`Error executing agent ${error}`);
      throw new InternalServerErrorException(error);
    }
    return result;
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('agent/stream')
  async agentStream(
    @Body() data: any,
    @VaultSession() vaultId: string,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emit = (event: string, payload: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      await this.vaultAgentService.executeStream(
        {
          message: data.message,
          decisions: data.decisions ?? {},
          conversationId: data.conversationId ?? '',
          vaultId,
        },
        emit,
      );
    } catch (error) {
      this.logger.error(`Stream error: ${error}`);
      emit('error', { message: 'Internal server error' });
    }

    res.end();
  }
}
