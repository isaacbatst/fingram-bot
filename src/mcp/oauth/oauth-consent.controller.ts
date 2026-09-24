import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { VaultAccessTokenGuard } from '@/vault/vault-access-token.guard';
import { VaultSession } from '@/vault/vault-session.decorator';
import { OAuthConsentService } from './oauth-consent.service';
import { OAuthRepository } from './oauth.repository';

/**
 * Endpoints used by the fingram-ui consent screen. They sit behind the regular
 * app CORS policy (credentialed, allow-listed origins), unlike the OAuth
 * endpoints that MCP clients call directly.
 */
@Controller('oauth/consent')
export class OAuthConsentController {
  constructor(private readonly consentService: OAuthConsentService) {}

  @Get()
  async describe(@Query('request') request?: string) {
    if (!request) throw new BadRequestException('request é obrigatório');
    const [error, details] = await this.consentService.describe(request);
    if (error !== null) throw new BadRequestException(error);
    return details;
  }

  @UseGuards(VaultAccessTokenGuard)
  @Post('approve')
  @HttpCode(200)
  async approve(
    @VaultSession() vaultId: string,
    @Body('request') request?: string,
  ) {
    if (!request) throw new BadRequestException('request é obrigatório');
    const [error, result] = await this.consentService.approve(request, vaultId);
    if (error !== null) throw new BadRequestException(error);
    return result;
  }

  @Post('deny')
  @HttpCode(200)
  async deny(@Body('request') request?: string) {
    if (!request) throw new BadRequestException('request é obrigatório');
    const [error, result] = await this.consentService.deny(request);
    if (error !== null) throw new BadRequestException(error);
    return result;
  }
}

/** Connected MCP clients of the current vault, for the "Conexões" screen. */
@Controller('vault/mcp-connections')
@UseGuards(VaultAccessTokenGuard)
export class McpConnectionsController {
  constructor(private readonly repository: OAuthRepository) {}

  @Get()
  async list(@VaultSession() vaultId: string) {
    const connections = await this.repository.listConnections(
      vaultId,
      new Date(),
    );
    return connections.sort(
      (a, b) => b.connectedAt.getTime() - a.connectedAt.getTime(),
    );
  }

  @Delete(':clientId')
  @HttpCode(204)
  async revoke(
    @VaultSession() vaultId: string,
    @Param('clientId') clientId: string,
  ) {
    const revoked = await this.repository.revokeConnection(
      vaultId,
      clientId,
      new Date(),
    );
    if (revoked === 0) throw new NotFoundException('Conexão não encontrada');
  }
}
