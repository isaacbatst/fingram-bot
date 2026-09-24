/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import * as schema from '@/shared/persistence/drizzle/schema';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp, truncateAll } from './setup';

const REDIRECT_URI = 'http://localhost:9999/callback';

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

describe('MCP server + OAuth (integration)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let clientId: string;

  const http = () => request(app.getHttpServer());

  async function createVault(): Promise<{ id: string; token: string }> {
    const res = await http().post('/vault/create').expect(201);
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'])
      .find((c) => c.startsWith('vault_access_token='))!;
    const token = cookie.split(';')[0].split('=')[1];
    return { id: res.body.vaultId, token };
  }

  /** Runs /authorize and returns the signed request the consent screen gets. */
  async function startAuthorization(challenge: string, state = 'xyz') {
    const res = await http()
      .get('/authorize')
      .query({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      })
      .expect(302);
    const location = new URL(res.headers.location);
    expect(location.pathname).toBe('/');
    return location.searchParams.get('oauth_request')!;
  }

  async function authorizeCode(vaultToken: string, challenge: string) {
    const signed = await startAuthorization(challenge);
    const res = await http()
      .post('/oauth/consent/approve')
      .set('Cookie', `vault_access_token=${vaultToken}`)
      .send({ request: signed })
      .expect(200);
    const redirect = new URL(res.body.redirectUrl);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
    expect(redirect.searchParams.get('state')).toBe('xyz');
    return redirect.searchParams.get('code')!;
  }

  function exchangeCode(code: string, verifier: string) {
    return http().post('/token').type('form').send({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
    });
  }

  async function connect(vaultToken: string) {
    const { verifier, challenge } = pkce();
    const code = await authorizeCode(vaultToken, challenge);
    const res = await exchangeCode(code, verifier).expect(200);
    return res.body as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  }

  let rpcId = 0;
  function mcp(accessToken: string, method: string, params: unknown = {}) {
    return http()
      .post('/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++rpcId, method, params });
  }

  async function callTool(
    accessToken: string,
    name: string,
    args: Record<string, unknown> = {},
  ) {
    const res = await mcp(accessToken, 'tools/call', {
      name,
      arguments: args,
    }).expect(200);
    const result = res.body.result;
    const text = result.content[0].text as string;
    return {
      isError: result.isError === true,
      text,
      data: result.isError ? undefined : JSON.parse(text),
    };
  }

  beforeAll(async () => {
    const result = await startTestApp();
    app = result.app;
    db = result.db;

    // DCR is rate limited per IP (20/hour), so the suite registers one client.
    const res = await http()
      .post('/register')
      .send({
        client_name: 'Cliente de Teste',
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      })
      .expect(201);
    clientId = res.body.client_id;
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  describe('discovery', () => {
    it('advertises authorization server metadata', async () => {
      const res = await http()
        .get('/.well-known/oauth-authorization-server')
        .expect(200);
      expect(res.body.authorization_endpoint).toMatch(/\/authorize$/);
      expect(res.body.token_endpoint).toMatch(/\/token$/);
      expect(res.body.registration_endpoint).toMatch(/\/register$/);
      expect(res.body.code_challenge_methods_supported).toContain('S256');
    });

    it('advertises protected resource metadata for /mcp', async () => {
      const res = await http()
        .get('/.well-known/oauth-protected-resource/mcp')
        .expect(200);
      expect(res.body.resource).toMatch(/\/mcp$/);
      expect(res.body.authorization_servers).toHaveLength(1);
    });

    it('rejects /mcp without a token, pointing to the resource metadata', async () => {
      const res = await http()
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        .expect(401);
      expect(res.headers['www-authenticate']).toContain('resource_metadata=');
    });
  });

  describe('authorization flow', () => {
    it('describes the pending request to the consent screen', async () => {
      const signed = await startAuthorization(pkce().challenge);
      const res = await http()
        .get('/oauth/consent')
        .query({ request: signed })
        .expect(200);
      expect(res.body).toEqual({
        clientName: 'Cliente de Teste',
        clientUri: null,
        redirectUri: REDIRECT_URI,
      });
    });

    it('requires a vault session to approve', async () => {
      const signed = await startAuthorization(pkce().challenge);
      await http()
        .post('/oauth/consent/approve')
        .send({ request: signed })
        .expect(401);
    });

    it('redirects with access_denied when the user denies', async () => {
      const signed = await startAuthorization(pkce().challenge);
      const res = await http()
        .post('/oauth/consent/deny')
        .send({ request: signed })
        .expect(200);
      const redirect = new URL(res.body.redirectUrl);
      expect(redirect.searchParams.get('error')).toBe('access_denied');
      expect(redirect.searchParams.get('state')).toBe('xyz');
      expect(redirect.searchParams.get('code')).toBeNull();
    });

    it('rejects a forged request with an unregistered redirect_uri', async () => {
      const vault = await createVault();
      const forged = await new JwtService().signAsync(
        {
          clientId,
          redirectUri: 'https://evil.example/callback',
          codeChallenge: pkce().challenge,
          state: null,
          scopes: [],
          resource: null,
        },
        {
          secret: process.env.JWT_SECRET || 'default_secret',
          audience: 'duna-mcp-consent',
          expiresIn: 600,
        },
      );
      await http()
        .post('/oauth/consent/approve')
        .set('Cookie', `vault_access_token=${vault.token}`)
        .send({ request: forged })
        .expect(400);
    });

    it('rejects a tampered request signature', async () => {
      const vault = await createVault();
      const signed = await startAuthorization(pkce().challenge);
      await http()
        .post('/oauth/consent/approve')
        .set('Cookie', `vault_access_token=${vault.token}`)
        .send({ request: `${signed}x` })
        .expect(400);
    });

    it('issues tokens for a valid code + PKCE verifier', async () => {
      const vault = await createVault();
      const tokens = await connect(vault.token);
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.refresh_token).toBeTruthy();
      expect(tokens.expires_in).toBe(3600);

      const rows = await db
        .select()
        .from(schema.oauthToken)
        .where(eq(schema.oauthToken.vaultId, vault.id));
      expect(rows).toHaveLength(1);
      // Only hashes are persisted.
      expect(rows[0].accessTokenHash).not.toBe(tokens.access_token);
    });

    it('rejects a wrong PKCE verifier', async () => {
      const vault = await createVault();
      const { challenge } = pkce();
      const code = await authorizeCode(vault.token, challenge);
      const res = await exchangeCode(code, pkce().verifier).expect(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('accepts an authorization code only once', async () => {
      const vault = await createVault();
      const { verifier, challenge } = pkce();
      const code = await authorizeCode(vault.token, challenge);
      await exchangeCode(code, verifier).expect(200);
      const res = await exchangeCode(code, verifier).expect(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('rejects a redirect_uri different from the one authorized', async () => {
      const vault = await createVault();
      const { verifier, challenge } = pkce();
      const code = await authorizeCode(vault.token, challenge);
      const res = await http()
        .post('/token')
        .type('form')
        .send({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: 'http://localhost:1234/callback',
        })
        .expect(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('rotates the refresh token and kills the previous grant', async () => {
      const vault = await createVault();
      const first = await connect(vault.token);

      const res = await http()
        .post('/token')
        .type('form')
        .send({
          grant_type: 'refresh_token',
          refresh_token: first.refresh_token,
          client_id: clientId,
        })
        .expect(200);
      const second = res.body;
      expect(second.refresh_token).not.toBe(first.refresh_token);

      await mcp(second.access_token, 'tools/list').expect(200);
      await mcp(first.access_token, 'tools/list').expect(401);
      const reuse = await http()
        .post('/token')
        .type('form')
        .send({
          grant_type: 'refresh_token',
          refresh_token: first.refresh_token,
          client_id: clientId,
        })
        .expect(400);
      expect(reuse.body.error).toBe('invalid_grant');
    });

    it('rejects an expired access token', async () => {
      const vault = await createVault();
      const tokens = await connect(vault.token);
      await db
        .update(schema.oauthToken)
        .set({ accessExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.oauthToken.vaultId, vault.id));
      await mcp(tokens.access_token, 'tools/list').expect(401);
    });
  });

  describe('tools', () => {
    it('lists read and write tools with MCP annotations', async () => {
      const vault = await createVault();
      const { access_token } = await connect(vault.token);
      const res = await mcp(access_token, 'tools/list').expect(200);
      const tools = res.body.result.tools as {
        name: string;
        annotations: { readOnlyHint?: boolean; destructiveHint?: boolean };
      }[];
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      expect(Object.keys(byName).sort()).toEqual(
        [
          'addAllocation',
          'addTransaction',
          'deleteTransaction',
          'getBudgetSummary',
          'getCategories',
          'getPlan',
          'getProjection',
          'listPlans',
          'listTransactions',
          'removeAllocation',
          'updateAllocation',
          'updatePremises',
        ].sort(),
      );
      expect(byName.listTransactions.annotations.readOnlyHint).toBe(true);
      expect(byName.addTransaction.annotations.readOnlyHint).toBe(false);
      expect(byName.deleteTransaction.annotations.destructiveHint).toBe(true);
      expect(byName.removeAllocation.annotations.destructiveHint).toBe(true);
    });

    it('adds, lists, summarizes and deletes transactions of the authorized vault', async () => {
      const vault = await createVault();
      const { access_token } = await connect(vault.token);
      const today = new Date().toISOString().slice(0, 10);

      const added = await callTool(access_token, 'addTransaction', {
        amount: 42.5,
        type: 'expense',
        date: today,
        description: 'Padaria',
      });
      expect(added.isError).toBe(false);
      expect(added.data.amount).toBe(42.5);
      expect(added.data.currentBalance).toBe(-42.5);

      const listed = await callTool(access_token, 'listTransactions');
      expect(listed.data.total).toBe(1);
      expect(listed.data.items[0]).toMatchObject({
        code: added.data.code,
        amount: 42.5,
        type: 'expense',
        description: 'Padaria',
        date: today,
      });

      const summary = await callTool(access_token, 'getBudgetSummary');
      expect(summary.isError).toBe(false);
      expect(summary.data.spent).toBe(42.5);
      expect(summary.data.income).toBe(0);
      expect(summary.data.planCeiling).toBeNull();
      expect(summary.data.period.startDate <= today).toBe(true);
      expect(summary.data.period.endDate >= today).toBe(true);

      const deleted = await callTool(access_token, 'deleteTransaction', {
        code: added.data.code,
      });
      expect(deleted.isError).toBe(false);
      const after = await callTool(access_token, 'listTransactions');
      expect(after.data.total).toBe(0);
    });

    it('rejects a period with month but no year', async () => {
      const vault = await createVault();
      const { access_token } = await connect(vault.token);
      const res = await callTool(access_token, 'getBudgetSummary', {
        month: 3,
      });
      expect(res.isError).toBe(true);
    });

    it('reads and edits the plan of the authorized vault', async () => {
      const vault = await createVault();
      const { access_token } = await connect(vault.token);
      const created = await http()
        .post('/plans')
        .set('Cookie', `vault_access_token=${vault.token}`)
        .send({
          name: 'Plano',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [],
        })
        .expect(201);
      const planId = created.body.id;

      const plans = await callTool(access_token, 'listPlans');
      expect(plans.data.map((p: { id: string }) => p.id)).toEqual([planId]);

      const premises = await callTool(access_token, 'updatePremises', {
        planId,
        costOfLivingChangePoints: [{ month: 0, amount: 7000 }],
      });
      expect(premises.isError).toBe(false);
      expect(premises.data.premises.costOfLivingChangePoints).toEqual([
        { month: 0, amount: 7000 },
      ]);
      expect(premises.data.premises.salaryChangePoints).toEqual([
        { month: 0, amount: 10000 },
      ]);

      const added = await callTool(access_token, 'addAllocation', {
        planId,
        label: 'Reserva',
        target: 30000,
        monthlyAmount: [{ month: 0, amount: 1000 }],
        realizationMode: 'manual',
      });
      expect(added.isError).toBe(false);

      const updated = await callTool(access_token, 'updateAllocation', {
        allocationId: added.data.id,
        target: 40000,
      });
      expect(updated.data.target).toBe(40000);

      const plan = await callTool(access_token, 'getPlan', { planId });
      expect(plan.data.allocations).toHaveLength(1);
      expect(plan.data.allocations[0].label).toBe('Reserva');

      const projection = await callTool(access_token, 'getProjection', {
        planId,
        months: 12,
      });
      expect(projection.data).toHaveLength(12);

      const removed = await callTool(access_token, 'removeAllocation', {
        allocationId: added.data.id,
      });
      expect(removed.isError).toBe(false);
      const after = await callTool(access_token, 'getPlan', { planId });
      expect(after.data.allocations).toHaveLength(0);
    });

    it("cannot read or change another vault's data", async () => {
      const mine = await createVault();
      const other = await createVault();
      const { access_token } = await connect(mine.token);

      const otherPlan = await http()
        .post('/plans')
        .set('Cookie', `vault_access_token=${other.token}`)
        .send({
          name: 'Plano alheio',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Reserva alheia',
              target: 0,
              monthlyAmount: [{ month: 0, amount: 500 }],
              realizationMode: 'manual',
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);
      const otherAllocationId = otherPlan.body.allocations[0].id;
      await http()
        .post('/vault/create-transaction')
        .set('Cookie', `vault_access_token=${other.token}`)
        .send({ amount: 99, type: 'expense', description: 'Alheia' })
        .expect(201);

      expect((await callTool(access_token, 'listPlans')).data).toEqual([]);
      expect(
        (await callTool(access_token, 'listTransactions', { allPeriods: true }))
          .data.total,
      ).toBe(0);
      expect(
        (await callTool(access_token, 'getPlan', { planId: otherPlan.body.id }))
          .isError,
      ).toBe(true);
      expect(
        (
          await callTool(access_token, 'updatePremises', {
            planId: otherPlan.body.id,
            salaryChangePoints: [{ month: 0, amount: 1 }],
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await callTool(access_token, 'removeAllocation', {
            allocationId: otherAllocationId,
          })
        ).isError,
      ).toBe(true);

      const stillThere = await db
        .select()
        .from(schema.allocation)
        .where(eq(schema.allocation.id, otherAllocationId));
      expect(stillThere).toHaveLength(1);
    });
  });

  describe('real MCP client', () => {
    it('initializes and calls tools through the SDK client over HTTP', async () => {
      const vault = await createVault();
      const { access_token } = await connect(vault.token);

      const server = app.getHttpServer();
      if (!server.listening) await new Promise((r) => server.listen(0, r));
      const { port } = server.address() as AddressInfo;

      const client = new Client({ name: 'integration-test', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        {
          requestInit: { headers: { Authorization: `Bearer ${access_token}` } },
        },
      );
      await client.connect(transport);
      try {
        expect(client.getServerVersion()?.name).toBe('duna');
        expect(client.getInstructions()).toContain('Duna');

        const { tools } = await client.listTools();
        expect(tools.length).toBe(12);

        const result = await client.callTool({
          name: 'getBudgetSummary',
          arguments: {},
        });
        expect(result.isError).toBeFalsy();
        const content = result.content as { type: string; text: string }[];
        expect(JSON.parse(content[0].text).spent).toBe(0);
      } finally {
        await client.close();
      }
    });
  });

  describe('connections', () => {
    it('lists the connected client and revokes it', async () => {
      const vault = await createVault();
      const other = await createVault();
      const { access_token } = await connect(vault.token);
      await mcp(access_token, 'tools/list').expect(200);

      const list = await http()
        .get('/vault/mcp-connections')
        .set('Cookie', `vault_access_token=${vault.token}`)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        clientId,
        clientName: 'Cliente de Teste',
      });
      expect(list.body[0].lastUsedAt).toBeTruthy();

      const otherList = await http()
        .get('/vault/mcp-connections')
        .set('Cookie', `vault_access_token=${other.token}`)
        .expect(200);
      expect(otherList.body).toEqual([]);
      await http()
        .delete(`/vault/mcp-connections/${clientId}`)
        .set('Cookie', `vault_access_token=${other.token}`)
        .expect(404);
      await mcp(access_token, 'tools/list').expect(200);

      await http()
        .delete(`/vault/mcp-connections/${clientId}`)
        .set('Cookie', `vault_access_token=${vault.token}`)
        .expect(204);
      await mcp(access_token, 'tools/list').expect(401);

      const after = await http()
        .get('/vault/mcp-connections')
        .set('Cookie', `vault_access_token=${vault.token}`)
        .expect(200);
      expect(after.body).toEqual([]);
    });
  });
});
