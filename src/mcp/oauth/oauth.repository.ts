import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

export type OAuthAuthorizationCodeRecord = {
  codeHash: string;
  clientId: string;
  vaultId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type OAuthTokenRecord = {
  id: string;
  clientId: string;
  vaultId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  scopes: string[];
  resource: string | null;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

export type OAuthConnection = {
  clientId: string;
  clientName: string | null;
  connectedAt: Date;
  lastUsedAt: Date | null;
};

export abstract class OAuthRepository {
  abstract saveClient(client: OAuthClientInformationFull): Promise<void>;
  abstract findClient(
    clientId: string,
  ): Promise<OAuthClientInformationFull | null>;

  abstract createAuthorizationCode(
    code: OAuthAuthorizationCodeRecord,
  ): Promise<void>;
  abstract findAuthorizationCode(
    codeHash: string,
  ): Promise<OAuthAuthorizationCodeRecord | null>;
  /**
   * Marks the code as used if it is still unused and unexpired, returning it.
   * Returns null when another exchange already consumed it (single use).
   */
  abstract consumeAuthorizationCode(
    codeHash: string,
    now: Date,
  ): Promise<OAuthAuthorizationCodeRecord | null>;

  abstract createToken(token: OAuthTokenRecord): Promise<void>;
  abstract findByAccessTokenHash(
    hash: string,
  ): Promise<OAuthTokenRecord | null>;
  abstract findByRefreshTokenHash(
    hash: string,
  ): Promise<OAuthTokenRecord | null>;
  /**
   * Revokes the grant if it is not revoked yet. Returns whether this call
   * revoked it, so concurrent refreshes of the same token cannot both succeed.
   */
  abstract revokeToken(id: string, now: Date): Promise<boolean>;
  abstract touchToken(id: string, now: Date): Promise<void>;

  /** Clients with at least one live grant (refresh token not expired). */
  abstract listConnections(
    vaultId: string,
    now: Date,
  ): Promise<OAuthConnection[]>;
  abstract revokeConnection(
    vaultId: string,
    clientId: string,
    now: Date,
  ): Promise<number>;
}
