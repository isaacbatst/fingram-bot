import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, max, min } from 'drizzle-orm';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import {
  oauthAuthorizationCode,
  oauthClient,
  oauthToken,
} from '@/shared/persistence/drizzle/schema';
import {
  OAuthAuthorizationCodeRecord,
  OAuthConnection,
  OAuthRepository,
  OAuthTokenRecord,
} from '../oauth.repository';

@Injectable()
export class OAuthDrizzleRepository extends OAuthRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  async saveClient(client: OAuthClientInformationFull): Promise<void> {
    await this.db.insert(oauthClient).values({
      clientId: client.client_id,
      clientInfo: client,
      createdAt: new Date(),
    });
  }

  async findClient(
    clientId: string,
  ): Promise<OAuthClientInformationFull | null> {
    const rows = await this.db
      .select()
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId));
    if (rows.length === 0) return null;
    return rows[0].clientInfo as OAuthClientInformationFull;
  }

  async createAuthorizationCode(
    code: OAuthAuthorizationCodeRecord,
  ): Promise<void> {
    await this.db.insert(oauthAuthorizationCode).values(code);
  }

  async findAuthorizationCode(
    codeHash: string,
  ): Promise<OAuthAuthorizationCodeRecord | null> {
    const rows = await this.db
      .select()
      .from(oauthAuthorizationCode)
      .where(eq(oauthAuthorizationCode.codeHash, codeHash));
    if (rows.length === 0) return null;
    return this.toCode(rows[0]);
  }

  async consumeAuthorizationCode(
    codeHash: string,
    now: Date,
  ): Promise<OAuthAuthorizationCodeRecord | null> {
    const rows = await this.db
      .update(oauthAuthorizationCode)
      .set({ usedAt: now })
      .where(
        and(
          eq(oauthAuthorizationCode.codeHash, codeHash),
          isNull(oauthAuthorizationCode.usedAt),
          gt(oauthAuthorizationCode.expiresAt, now),
        ),
      )
      .returning();
    if (rows.length === 0) return null;
    return this.toCode(rows[0]);
  }

  async createToken(token: OAuthTokenRecord): Promise<void> {
    await this.db.insert(oauthToken).values(token);
  }

  async findByAccessTokenHash(hash: string): Promise<OAuthTokenRecord | null> {
    const rows = await this.db
      .select()
      .from(oauthToken)
      .where(eq(oauthToken.accessTokenHash, hash));
    if (rows.length === 0) return null;
    return this.toToken(rows[0]);
  }

  async findByRefreshTokenHash(hash: string): Promise<OAuthTokenRecord | null> {
    const rows = await this.db
      .select()
      .from(oauthToken)
      .where(eq(oauthToken.refreshTokenHash, hash));
    if (rows.length === 0) return null;
    return this.toToken(rows[0]);
  }

  async revokeToken(id: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(oauthToken)
      .set({ revokedAt: now })
      .where(and(eq(oauthToken.id, id), isNull(oauthToken.revokedAt)))
      .returning();
    return rows.length > 0;
  }

  async touchToken(id: string, now: Date): Promise<void> {
    await this.db
      .update(oauthToken)
      .set({ lastUsedAt: now })
      .where(eq(oauthToken.id, id));
  }

  async listConnections(
    vaultId: string,
    now: Date,
  ): Promise<OAuthConnection[]> {
    const rows = await this.db
      .select({
        clientId: oauthToken.clientId,
        clientInfo: oauthClient.clientInfo,
        connectedAt: min(oauthToken.createdAt),
        lastUsedAt: max(oauthToken.lastUsedAt),
      })
      .from(oauthToken)
      .innerJoin(oauthClient, eq(oauthClient.clientId, oauthToken.clientId))
      .where(
        and(
          eq(oauthToken.vaultId, vaultId),
          isNull(oauthToken.revokedAt),
          gt(oauthToken.refreshExpiresAt, now),
        ),
      )
      .groupBy(oauthToken.clientId, oauthClient.clientInfo);

    return rows.map((row) => ({
      clientId: row.clientId,
      clientName:
        (row.clientInfo as OAuthClientInformationFull).client_name ?? null,
      connectedAt: row.connectedAt as Date,
      lastUsedAt: row.lastUsedAt,
    }));
  }

  async revokeConnection(
    vaultId: string,
    clientId: string,
    now: Date,
  ): Promise<number> {
    const rows = await this.db
      .update(oauthToken)
      .set({ revokedAt: now })
      .where(
        and(
          eq(oauthToken.vaultId, vaultId),
          eq(oauthToken.clientId, clientId),
          isNull(oauthToken.revokedAt),
        ),
      )
      .returning();
    return rows.length;
  }

  private toCode(
    row: typeof oauthAuthorizationCode.$inferSelect,
  ): OAuthAuthorizationCodeRecord {
    return { ...row, scopes: row.scopes as string[] };
  }

  private toToken(row: typeof oauthToken.$inferSelect): OAuthTokenRecord {
    return { ...row, scopes: row.scopes as string[] };
  }
}
