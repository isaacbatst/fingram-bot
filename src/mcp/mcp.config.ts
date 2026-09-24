import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Public URLs the MCP server advertises. The OAuth metadata, the protected
 * resource metadata and the consent redirect are all derived from these, so
 * they must be the URLs an MCP client (Claude, ChatGPT...) can reach.
 */
@Injectable()
export class McpConfig {
  constructor(private readonly configService: ConfigService) {}

  /** Base URL of this API, e.g. https://api.duna.app (no trailing slash). */
  get apiPublicUrl(): string {
    const configured = this.configService.get<string>('API_PUBLIC_URL');
    const fallback = `http://localhost:${this.configService.get<string>('PORT') ?? 3002}`;
    return stripTrailingSlash(configured ?? fallback);
  }

  get mcpUrl(): URL {
    return new URL(`${this.apiPublicUrl}/mcp`);
  }

  /** Where the consent screen lives (fingram-ui). */
  get frontendUrl(): string {
    return stripTrailingSlash(
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173',
    );
  }

  get jwtSecret(): string {
    // Same secret and fallback as the mini app session token.
    return this.configService.get<string>('JWT_SECRET') || 'default_secret';
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
