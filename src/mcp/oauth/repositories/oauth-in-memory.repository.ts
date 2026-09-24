/* eslint-disable @typescript-eslint/require-await */
import { Injectable } from '@nestjs/common';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  OAuthAuthorizationCodeRecord,
  OAuthConnection,
  OAuthRepository,
  OAuthTokenRecord,
} from '../oauth.repository';

@Injectable()
export class OAuthInMemoryRepository extends OAuthRepository {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly codes = new Map<string, OAuthAuthorizationCodeRecord>();
  private readonly tokens = new Map<string, OAuthTokenRecord>();

  async saveClient(client: OAuthClientInformationFull): Promise<void> {
    this.clients.set(client.client_id, client);
  }

  async findClient(
    clientId: string,
  ): Promise<OAuthClientInformationFull | null> {
    return this.clients.get(clientId) ?? null;
  }

  async createAuthorizationCode(
    code: OAuthAuthorizationCodeRecord,
  ): Promise<void> {
    this.codes.set(code.codeHash, { ...code });
  }

  async findAuthorizationCode(
    codeHash: string,
  ): Promise<OAuthAuthorizationCodeRecord | null> {
    const code = this.codes.get(codeHash);
    return code ? { ...code } : null;
  }

  async consumeAuthorizationCode(
    codeHash: string,
    now: Date,
  ): Promise<OAuthAuthorizationCodeRecord | null> {
    const code = this.codes.get(codeHash);
    if (!code || code.usedAt || code.expiresAt <= now) return null;
    code.usedAt = now;
    return { ...code };
  }

  async createToken(token: OAuthTokenRecord): Promise<void> {
    this.tokens.set(token.id, { ...token });
  }

  async findByAccessTokenHash(hash: string): Promise<OAuthTokenRecord | null> {
    const token = [...this.tokens.values()].find(
      (t) => t.accessTokenHash === hash,
    );
    return token ? { ...token } : null;
  }

  async findByRefreshTokenHash(hash: string): Promise<OAuthTokenRecord | null> {
    const token = [...this.tokens.values()].find(
      (t) => t.refreshTokenHash === hash,
    );
    return token ? { ...token } : null;
  }

  async revokeToken(id: string, now: Date): Promise<boolean> {
    const token = this.tokens.get(id);
    if (!token || token.revokedAt) return false;
    token.revokedAt = now;
    return true;
  }

  async touchToken(id: string, now: Date): Promise<void> {
    const token = this.tokens.get(id);
    if (token) token.lastUsedAt = now;
  }

  async listConnections(
    vaultId: string,
    now: Date,
  ): Promise<OAuthConnection[]> {
    const byClient = new Map<string, OAuthConnection>();
    for (const token of this.tokens.values()) {
      if (
        token.vaultId !== vaultId ||
        token.revokedAt ||
        token.refreshExpiresAt <= now
      ) {
        continue;
      }
      const current = byClient.get(token.clientId);
      const lastUsedAt =
        [current?.lastUsedAt, token.lastUsedAt]
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      byClient.set(token.clientId, {
        clientId: token.clientId,
        clientName: this.clients.get(token.clientId)?.client_name ?? null,
        connectedAt:
          current && current.connectedAt < token.createdAt
            ? current.connectedAt
            : token.createdAt,
        lastUsedAt,
      });
    }
    return [...byClient.values()];
  }

  async revokeConnection(
    vaultId: string,
    clientId: string,
    now: Date,
  ): Promise<number> {
    let count = 0;
    for (const token of this.tokens.values()) {
      if (
        token.vaultId === vaultId &&
        token.clientId === clientId &&
        !token.revokedAt
      ) {
        token.revokedAt = now;
        count++;
      }
    }
    return count;
  }
}
