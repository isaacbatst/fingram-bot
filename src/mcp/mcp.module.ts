import {
  DynamicModule,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnModuleInit,
  RequestMethod,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Express } from 'express';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { RepositoriesModule } from '@/shared/persistence/repositories.module';
import { PlanModule } from '@/plan/plan.module';
import { VaultModule } from '@/vault/vault.module';
import { ImportModule } from '@/vault/import.module';
import { DunaMcpServerFactory } from './duna-mcp-server.factory';
import { McpConfig } from './mcp.config';
import { McpController } from './mcp.controller';
import { DunaOAuthProvider } from './oauth/duna-oauth.provider';
import {
  McpConnectionsController,
  OAuthConsentController,
} from './oauth/oauth-consent.controller';
import { OAuthConsentService } from './oauth/oauth-consent.service';
import {
  OAuthDrizzleRepositoriesModule,
  OAuthInMemoryRepositoriesModule,
} from './oauth/repositories/oauth-repositories.module';

/**
 * Remote MCP server of Duna: OAuth 2.1 authorization server (grants bound to a
 * vault) + Streamable HTTP endpoint at /mcp with the Duna tools.
 */
@Module({})
export class McpModule implements NestModule, OnModuleInit {
  static register(): DynamicModule {
    return {
      module: McpModule,
      imports: [
        JwtModule.register({}),
        RepositoriesModule.forFeature({
          drizzle: OAuthDrizzleRepositoriesModule,
          'in-memory': OAuthInMemoryRepositoriesModule,
          sqlite: OAuthInMemoryRepositoriesModule,
        }),
        VaultModule.register(),
        // CardInvoiceService, for the invoice tools
        ImportModule.register(),
        PlanModule.register(),
      ],
      controllers: [
        McpController,
        OAuthConsentController,
        McpConnectionsController,
      ],
      providers: [
        McpConfig,
        DunaOAuthProvider,
        OAuthConsentService,
        DunaMcpServerFactory,
      ],
    };
  }

  constructor(
    private readonly provider: DunaOAuthProvider,
    private readonly config: McpConfig,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  /**
   * The SDK router serves /.well-known/*, /authorize, /token, /register and
   * /revoke, and must sit at the application root (it matches absolute paths).
   * Nest middleware is mounted under a path prefix, so it goes straight on the
   * Express instance. Nest routes are already registered at this point and none
   * of them overlap these paths.
   */
  onModuleInit() {
    const issuerUrl = new URL(this.config.apiPublicUrl);
    this.httpAdapterHost.httpAdapter.getInstance<Express>().use(
      mcpAuthRouter({
        provider: this.provider,
        issuerUrl,
        resourceServerUrl: this.config.mcpUrl,
        resourceName: 'Duna',
      }),
    );
  }

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        requireBearerAuth({
          verifier: this.provider,
          resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
            this.config.mcpUrl,
          ),
        }),
      )
      .forRoutes({ path: 'mcp', method: RequestMethod.ALL });
  }
}
