import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { VaultService } from './vault.service';

@Injectable()
export class VaultAccessTokenGuard implements CanActivate {
  constructor(private readonly vaultService: VaultService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();

    const accessToken = this.extractTokenFromCookie(request);

    if (!accessToken) {
      throw new UnauthorizedException('No vault access token provided');
    }

    try {
      // Find vault by access token
      const vault = await this.vaultService.findByToken(accessToken);

      if (!vault) {
        throw new UnauthorizedException('Invalid vault access token');
      }

      // Store vault ID in request for use in controllers
      request['vault_id'] = vault.id;

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid vault access token');
    }
  }

  private extractTokenFromCookie(request: Request): string | undefined {
    return request.cookies?.vault_access_token as string | undefined;
  }
}
