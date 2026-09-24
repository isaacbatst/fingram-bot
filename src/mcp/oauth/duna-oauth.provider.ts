import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { Response } from 'express';
import {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpConfig } from '../mcp.config';
import { OAuthRepository, OAuthTokenRecord } from './oauth.repository';
import { generateSecret, hashSecret } from './oauth-secrets';
import {
  AuthorizationRequest,
  signAuthorizationRequest,
} from './oauth-consent.service';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d
// lastUsedAt is informational (shown on the connections screen); writing it on
// every MCP request would be wasteful.
const TOUCH_INTERVAL_MS = 60 * 1000;

export type DunaAuthExtra = { vaultId: string };

/**
 * OAuth 2.1 authorization server for the MCP endpoint, plugged into the SDK's
 * `mcpAuthRouter` (which handles metadata, DCR, PKCE verification, request
 * validation and rate limiting). Grants are bound to a vault.
 */
@Injectable()
export class DunaOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(
    private readonly repository: OAuthRepository,
    private readonly jwtService: JwtService,
    private readonly config: McpConfig,
  ) {
    this.clientsStore = {
      getClient: async (clientId) =>
        (await this.repository.findClient(clientId)) ?? undefined,
      registerClient: async (client) => {
        // The SDK generates client_id (and a secret for confidential clients)
        // before calling us, so the object is complete at this point.
        const full = client as OAuthClientInformationFull;
        await this.repository.saveClient(full);
        return full;
      },
    };
  }

  /**
   * The SDK already validated client_id, redirect_uri and PKCE presence. The
   * user decides on the consent screen (fingram-ui), which then calls
   * OAuthConsentController to get the code issued.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const request: AuthorizationRequest = {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? null,
      scopes: params.scopes ?? [],
      resource: params.resource?.href ?? null,
    };
    const signed = await signAuthorizationRequest(
      this.jwtService,
      this.config.jwtSecret,
      request,
    );
    // The web app has no path routing (and no SPA rewrite on the host), so
    // the consent screen is addressed by a query param on the root.
    const consentUrl = new URL(`${this.config.frontendUrl}/`);
    consentUrl.searchParams.set('oauth_request', signed);
    res.redirect(302, consentUrl.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const code = await this.repository.findAuthorizationCode(
      hashSecret(authorizationCode),
    );
    if (!code || code.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const codeHash = hashSecret(authorizationCode);
    const existing = await this.repository.findAuthorizationCode(codeHash);
    if (!existing || existing.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    // The SDK accepts any loopback port at /authorize, so the exact URI used
    // there must be enforced here.
    if (redirectUri !== undefined && redirectUri !== existing.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match');
    }
    const code = await this.repository.consumeAuthorizationCode(
      codeHash,
      new Date(),
    );
    if (!code) {
      throw new InvalidGrantError('Authorization code expired or already used');
    }
    return this.issueTokens({
      clientId: code.clientId,
      vaultId: code.vaultId,
      scopes: code.scopes,
      resource: code.resource,
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const now = new Date();
    const token = await this.repository.findByRefreshTokenHash(
      hashSecret(refreshToken),
    );
    if (
      !token ||
      token.clientId !== client.client_id ||
      token.revokedAt ||
      token.refreshExpiresAt <= now
    ) {
      throw new InvalidGrantError('Invalid refresh token');
    }
    // Rotation: the old grant dies with this exchange. The conditional revoke
    // makes a concurrent second use of the same refresh token fail.
    const revoked = await this.repository.revokeToken(token.id, now);
    if (!revoked) {
      throw new InvalidGrantError('Invalid refresh token');
    }
    return this.issueTokens({
      clientId: token.clientId,
      vaultId: token.vaultId,
      scopes: token.scopes,
      resource: token.resource,
    });
  }

  async verifyAccessToken(accessToken: string): Promise<AuthInfo> {
    const now = new Date();
    const token = await this.repository.findByAccessTokenHash(
      hashSecret(accessToken),
    );
    if (!token || token.revokedAt || token.accessExpiresAt <= now) {
      throw new InvalidTokenError('Invalid or expired access token');
    }
    if (
      !token.lastUsedAt ||
      now.getTime() - token.lastUsedAt.getTime() > TOUCH_INTERVAL_MS
    ) {
      await this.repository.touchToken(token.id, now);
    }
    const extra: DunaAuthExtra = { vaultId: token.vaultId };
    return {
      token: accessToken,
      clientId: token.clientId,
      scopes: token.scopes,
      expiresAt: Math.floor(token.accessExpiresAt.getTime() / 1000),
      resource: token.resource ? new URL(token.resource) : undefined,
      extra,
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const hash = hashSecret(request.token);
    const token =
      (await this.repository.findByAccessTokenHash(hash)) ??
      (await this.repository.findByRefreshTokenHash(hash));
    if (!token || token.clientId !== client.client_id) return;
    await this.repository.revokeToken(token.id, new Date());
  }

  private async issueTokens(grant: {
    clientId: string;
    vaultId: string;
    scopes: string[];
    resource: string | null;
  }): Promise<OAuthTokens> {
    const now = new Date();
    const accessToken = generateSecret();
    const refreshToken = generateSecret();
    const record: OAuthTokenRecord = {
      id: randomUUID(),
      clientId: grant.clientId,
      vaultId: grant.vaultId,
      accessTokenHash: hashSecret(accessToken),
      refreshTokenHash: hashSecret(refreshToken),
      scopes: grant.scopes,
      resource: grant.resource,
      accessExpiresAt: new Date(
        now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000,
      ),
      refreshExpiresAt: new Date(
        now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000,
      ),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    };
    await this.repository.createToken(record);
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      ...(grant.scopes.length > 0 ? { scope: grant.scopes.join(' ') } : {}),
    };
  }
}
