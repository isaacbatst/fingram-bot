/* eslint-disable @typescript-eslint/no-unsafe-return */
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
import {
  createTestTransaction,
  startTestApp,
  stopTestApp,
  truncateAll,
} from './setup';

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
          'categorizeTransactions',
          'createTransfer',
          'deleteTransaction',
          'deleteTransfer',
          'editTransaction',
          'editTransfer',
          'getBudgetSummary',
          'getCategories',
          'getPlan',
          'getProjection',
          'getSpendingBreakdown',
          'listEstratos',
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
      for (const name of [
        'editTransaction',
        'categorizeTransactions',
        'createTransfer',
        'editTransfer',
      ]) {
        expect(byName[name].annotations.readOnlyHint, name).toBe(false);
        expect(byName[name].annotations.destructiveHint, name).toBe(false);
      }
      expect(byName.deleteTransfer.annotations.destructiveHint).toBe(true);
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
        id: added.data.id,
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
        id: added.data.id,
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

  describe('filters and aggregation', () => {
    /**
     * Vault with two estratos over Jan–Feb 2026:
     *   Jan  Principal: food 100, transport 40, income 5000, planned payment 1200
     *        transfer 300 Principal → Reserva
     *   Feb  Principal: food 60   | Reserva: food 25
     */
    async function seed() {
      const vault = await createVault();
      const cookie = `vault_access_token=${vault.token}`;
      const food = crypto.randomUUID();
      const transport = crypto.randomUUID();
      await db.insert(schema.vaultCategory).values([
        {
          id: food,
          vaultId: vault.id,
          name: 'Alimentação',
          code: 'food',
          transactionType: 'expense',
        },
        {
          id: transport,
          vaultId: vault.id,
          name: 'Transporte',
          code: 'transport',
          transactionType: 'expense',
        },
      ]);
      const boxes = await http().get('/vault/boxes').set('Cookie', cookie);
      const main = (boxes.body as { id: string; isDefault: boolean }[]).find(
        (b) => b.isDefault,
      )!.id;
      const reserve = (
        await http()
          .post('/vault/create-box')
          .set('Cookie', cookie)
          .send({ name: 'Reserva', type: 'saving' })
          .expect(201)
      ).body.id as string;

      const add = (body: Record<string, unknown>) =>
        http()
          .post('/vault/create-transaction')
          .set('Cookie', cookie)
          .send(body)
          .expect(201);
      await add({
        amount: 100,
        type: 'expense',
        date: '2026-01-10',
        categoryId: food,
        boxId: main,
        description: 'Mercado',
      });
      await add({
        amount: 40,
        type: 'expense',
        date: '2026-01-12',
        categoryId: transport,
        boxId: main,
        description: 'Uber',
      });
      await add({
        amount: 5000,
        type: 'income',
        date: '2026-01-05',
        boxId: main,
        description: 'Salário',
      });
      await add({
        amount: 60,
        type: 'expense',
        date: '2026-02-03',
        categoryId: food,
        boxId: main,
        description: 'Mercado',
      });
      await add({
        amount: 25,
        type: 'expense',
        date: '2026-02-20',
        categoryId: food,
        boxId: reserve,
        description: 'Feira',
      });
      await http()
        .post('/vault/create-transfer')
        .set('Cookie', cookie)
        .send({
          fromBoxId: main,
          toBoxId: reserve,
          amount: 300,
          date: '2026-01-15',
        })
        .expect(201);

      const plan = await http()
        .post('/plans')
        .set('Cookie', cookie)
        .send({
          name: 'Plano',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 5000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 3000 }],
          },
          allocations: [
            {
              label: 'Financiamento',
              target: 0,
              monthlyAmount: [{ month: 0, amount: 1200 }],
              realizationMode: 'immediate',
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);
      await createTestTransaction(db, {
        vaultId: vault.id,
        amount: 1200,
        type: 'expense',
        date: new Date('2026-01-20T00:00:00.000Z'),
        boxId: main,
        allocationId: plan.body.allocations[0].id,
        description: 'Parcela',
      });

      const { access_token } = await connect(vault.token);
      return { access_token, cookie, food, main, reserve };
    }

    it('lists estratos with balances', async () => {
      const { access_token, main, reserve } = await seed();
      const res = await callTool(access_token, 'listEstratos');
      const byId = Object.fromEntries(
        (res.data as { id: string }[]).map((e) => [e.id, e]),
      );
      expect(byId[main]).toMatchObject({ kind: 'corrente', isDefault: true });
      expect(byId[reserve]).toMatchObject({
        name: 'Reserva',
        kind: 'reserva',
        isDefault: false,
        balance: 275, // 300 transferred in, 25 spent
      });
    });

    it('filters transactions by date range, type, estrato and amount', async () => {
      const { access_token, reserve } = await seed();
      const list = async (args: Record<string, unknown>) =>
        (await callTool(access_token, 'listTransactions', args)).data as {
          total: number;
          items: { description: string; amount: number }[];
        };

      // Whole range: 5 plain + transfer (expense side) + planned payment.
      expect((await list({ from: '2026-01-01', to: '2026-02-28' })).total).toBe(
        7,
      );
      // Inclusive day bounds.
      expect(
        (await list({ from: '2026-02-20', to: '2026-02-20' })).items.map(
          (t) => t.description,
        ),
      ).toEqual(['Feira']);
      // Open-ended range.
      expect((await list({ from: '2026-02-01' })).total).toBe(2);

      // Type excludes transfers.
      const expenses = await list({
        from: '2026-01-01',
        to: '2026-01-31',
        type: 'expense',
      });
      expect(expenses.items.map((t) => t.amount).sort((a, b) => a - b)).toEqual(
        [40, 100, 1200],
      );
      expect((await list({ allPeriods: true, type: 'income' })).total).toBe(1);

      // Estrato includes transfers into it.
      const inReserve = await list({ allPeriods: true, estratoId: reserve });
      expect(
        inReserve.items.map((t) => t.amount).sort((a, b) => a - b),
      ).toEqual([25, 300]);

      // Amount range, inclusive.
      const mid = await list({
        allPeriods: true,
        minAmount: 40,
        maxAmount: 100,
        type: 'expense',
      });
      expect(mid.items.map((t) => t.amount).sort((a, b) => a - b)).toEqual([
        40, 60, 100,
      ]);
    });

    it('rejects conflicting or inverted filters', async () => {
      const { access_token } = await seed();
      const cases: Record<string, unknown>[] = [
        { from: '2026-01-01', month: 1, year: 2026 },
        { from: '2026-01-01', allPeriods: true },
        { from: '2026-02-01', to: '2026-01-01' },
        { minAmount: 100, maxAmount: 10 },
      ];
      for (const args of cases) {
        const res = await callTool(access_token, 'listTransactions', args);
        expect(res.isError, JSON.stringify(args)).toBe(true);
      }
    });

    it('breaks spending down by category like the budget', async () => {
      const { access_token, food } = await seed();
      const res = await callTool(access_token, 'getSpendingBreakdown', {
        from: '2026-01-01',
        to: '2026-02-28',
      });
      expect(res.data.range).toEqual({ from: '2026-01-01', to: '2026-02-28' });
      // Transfer (300) and income are not spending.
      expect(res.data.total).toBe(1425);
      expect(res.data.groups).toEqual([
        {
          categoryId: null,
          categoryName: 'Pagamentos do plano',
          total: 1200,
          count: 1,
        },
        { categoryId: food, categoryName: 'Alimentação', total: 185, count: 3 },
        {
          categoryId: expect.any(String),
          categoryName: 'Transporte',
          total: 40,
          count: 1,
        },
      ]);
    });

    it('breaks down by budget month, by estrato and for income', async () => {
      const { access_token, reserve } = await seed();
      const byMonth = await callTool(access_token, 'getSpendingBreakdown', {
        from: '2026-01-01',
        to: '2026-02-28',
        groupBy: 'month',
      });
      expect(byMonth.data.groups).toEqual([
        { period: { month: 1, year: 2026 }, total: 1340, count: 3 },
        { period: { month: 2, year: 2026 }, total: 85, count: 2 },
      ]);

      const inReserve = await callTool(access_token, 'getSpendingBreakdown', {
        from: '2026-01-01',
        to: '2026-02-28',
        estratoId: reserve,
      });
      expect(inReserve.data.total).toBe(25);

      const february = await callTool(access_token, 'getSpendingBreakdown', {
        month: 2,
        year: 2026,
      });
      expect(february.data.range).toEqual({
        from: '2026-02-01',
        to: '2026-02-28',
      });
      expect(february.data.total).toBe(85);

      const income = await callTool(access_token, 'getSpendingBreakdown', {
        from: '2026-01-01',
        to: '2026-02-28',
        type: 'income',
      });
      expect(income.data.total).toBe(5000);
    });

    it('agrees with the budget summary on per-category spending', async () => {
      const { access_token, cookie, food } = await seed();
      await http()
        .post('/vault/set-budgets')
        .set('Cookie', cookie)
        .send({ budgets: [{ categoryCode: 'food', amount: 500 }] })
        .expect(201);

      for (const month of [1, 2]) {
        const summary = await callTool(access_token, 'getBudgetSummary', {
          month,
          year: 2026,
        });
        const budgetSpent = (
          summary.data.budgets as { categoryId: string; spent: number }[]
        ).find((b) => b.categoryId === food)!.spent;

        const breakdown = await callTool(access_token, 'getSpendingBreakdown', {
          month,
          year: 2026,
        });
        const breakdownFood = (
          breakdown.data.groups as { categoryId: string; total: number }[]
        ).find((g) => g.categoryId === food)!.total;

        expect(breakdownFood, `month ${month}`).toBe(budgetSpent);
      }
    });
  });

  describe('editing transactions', () => {
    type Item = {
      id: string;
      date: string;
      type: string;
      amount: number;
      description: string;
      category: { id: string; name: string } | null;
      estratoId: string | null;
      isTransfer: boolean;
      transferId: string | null;
      allocationId: string | null;
    };

    /**
     * Vault with categories food/transport (budgets 500/300), estratos
     * Principal + Reserva, and a plan with a Pagamento (Financiamento), a
     * Reserva (Viagem, manual) and a Reserva without realization (Colchão).
     */
    async function seed() {
      const vault = await createVault();
      const cookie = `vault_access_token=${vault.token}`;
      const food = crypto.randomUUID();
      const transport = crypto.randomUUID();
      await db.insert(schema.vaultCategory).values([
        {
          id: food,
          vaultId: vault.id,
          name: 'Alimentação',
          code: 'food',
          transactionType: 'expense',
        },
        {
          id: transport,
          vaultId: vault.id,
          name: 'Transporte',
          code: 'transport',
          transactionType: 'expense',
        },
      ]);
      await http()
        .post('/vault/set-budgets')
        .set('Cookie', cookie)
        .send({
          budgets: [
            { categoryCode: 'food', amount: 500 },
            { categoryCode: 'transport', amount: 300 },
          ],
        })
        .expect(201);
      const boxes = await http().get('/vault/boxes').set('Cookie', cookie);
      const main = (boxes.body as { id: string; isDefault: boolean }[]).find(
        (b) => b.isDefault,
      )!.id;
      const reserve = (
        await http()
          .post('/vault/create-box')
          .set('Cookie', cookie)
          .send({ name: 'Reserva', type: 'saving' })
          .expect(201)
      ).body.id as string;
      const plan = await http()
        .post('/plans')
        .set('Cookie', cookie)
        .send({
          name: 'Plano',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 5000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 3000 }],
          },
          allocations: [
            {
              label: 'Financiamento',
              target: 0,
              monthlyAmount: [{ month: 0, amount: 1200 }],
              realizationMode: 'immediate',
              scheduledMovements: [],
            },
            {
              label: 'Viagem',
              target: 10000,
              monthlyAmount: [{ month: 0, amount: 500 }],
              realizationMode: 'manual',
              scheduledMovements: [],
            },
            {
              label: 'Colchão',
              target: 20000,
              monthlyAmount: [{ month: 0, amount: 300 }],
              realizationMode: 'never',
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);
      const byLabel = Object.fromEntries(
        (plan.body.allocations as { id: string; label: string }[]).map((a) => [
          a.label,
          a.id,
        ]),
      );

      const add = async (body: Record<string, unknown>) => {
        const res = await http()
          .post('/vault/create-transaction')
          .set('Cookie', cookie)
          .send({ type: 'expense', boxId: main, ...body })
          .expect(201);
        return res.body.transaction.id as string;
      };

      const { access_token } = await connect(vault.token);
      return {
        vault,
        cookie,
        access_token,
        food,
        transport,
        main,
        reserve,
        add,
        financing: byLabel['Financiamento'],
        trip: byLabel['Viagem'],
        mattress: byLabel['Colchão'],
      };
    }

    async function row(vaultId: string, id: string) {
      const rows = await db
        .select()
        .from(schema.transaction)
        .where(eq(schema.transaction.vaultId, vaultId));
      return rows.find((r) => r.id === id);
    }

    async function budgetSpent(accessToken: string, categoryId: string) {
      const summary = await callTool(accessToken, 'getBudgetSummary', {
        month: 1,
        year: 2026,
      });
      return (
        summary.data.budgets as { categoryId: string; spent: number }[]
      ).find((b) => b.categoryId === categoryId)!.spent;
    }

    async function listed(accessToken: string, id: string) {
      const res = await callTool(accessToken, 'listTransactions', {
        allPeriods: true,
      });
      return (res.data.items as Item[]).find((t) => t.id === id);
    }

    it('changes only the fields sent and moves spending between category budgets', async () => {
      const s = await seed();
      const id = await s.add({
        amount: 100,
        date: '2026-01-10',
        categoryId: s.food,
        description: 'Mercado',
      });
      expect(await budgetSpent(s.access_token, s.food)).toBe(100);

      const recategorized = await callTool(s.access_token, 'editTransaction', {
        id,
        categoryId: s.transport,
      });
      expect(recategorized.isError).toBe(false);
      expect(recategorized.data).toMatchObject({
        id,
        amount: 100,
        type: 'expense',
        date: '2026-01-10',
        description: 'Mercado',
        category: { id: s.transport, name: 'Transporte' },
        estratoId: s.main,
        isTransfer: false,
        transferId: null,
        allocationId: null,
      });
      expect(await budgetSpent(s.access_token, s.food)).toBe(0);
      expect(await budgetSpent(s.access_token, s.transport)).toBe(100);

      const edited = await callTool(s.access_token, 'editTransaction', {
        id,
        amount: 80,
        date: '2026-01-20',
        description: 'Uber',
        estratoId: s.reserve,
      });
      expect(edited.data).toMatchObject({
        amount: 80,
        date: '2026-01-20',
        description: 'Uber',
        estratoId: s.reserve,
        category: { id: s.transport },
      });
      // Same shape as listTransactions.
      expect(await listed(s.access_token, id)).toEqual(edited.data);
      // Stored as UTC midnight, like addTransaction.
      expect((await row(s.vault.id, id))!.date!.toISOString()).toBe(
        '2026-01-20T00:00:00.000Z',
      );

      const cleared = await callTool(s.access_token, 'editTransaction', {
        id,
        categoryId: null,
      });
      expect(cleared.data.category).toBeNull();
      expect(cleared.data.amount).toBe(80);
      expect((await row(s.vault.id, id))!.categoryId).toBeNull();

      const income = await callTool(s.access_token, 'editTransaction', {
        id,
        type: 'income',
      });
      expect(income.data.type).toBe('income');
    });

    it('edits and deletes by id even when two transactions share a code', async () => {
      // Codes are 4 random hex chars and did repeat in production.
      const s = await seed();
      const first = await s.add({ amount: 10, date: '2026-01-10' });
      const second = await s.add({ amount: 20, date: '2026-01-11' });
      for (const id of [first, second]) {
        await db
          .update(schema.transaction)
          .set({ code: 'abcd' })
          .where(eq(schema.transaction.id, id));
      }

      const edited = await callTool(s.access_token, 'editTransaction', {
        id: second,
        amount: 25,
      });
      expect(edited.isError).toBe(false);
      expect(await row(s.vault.id, first)).toMatchObject({ amount: 10 });
      expect(await row(s.vault.id, second)).toMatchObject({ amount: 25 });

      await http()
        .post('/vault/delete-transaction')
        .set('Cookie', s.cookie)
        .send({ transactionId: second })
        .expect(201);
      expect(await row(s.vault.id, first)).toMatchObject({ amount: 10 });
      expect(await row(s.vault.id, second)).toBeUndefined();
    });

    it('rejects invalid edits with a message', async () => {
      const s = await seed();
      const id = await s.add({ amount: 50, date: '2026-01-10' });
      const cases: [Record<string, unknown>, string][] = [
        [{ id }, 'ao menos um campo'],
        [{ id: 'nope', amount: 10 }, 'não encontrada'],
        [{ id, categoryId: crypto.randomUUID() }, 'Categoria não encontrada'],
        [{ id, estratoId: crypto.randomUUID() }, 'Estrato não encontrado'],
        [{ id, withdrawalType: 'withdrawal' }, 'allocationId'],
        [{ id, allocationId: crypto.randomUUID() }, 'Alocação não encontrada'],
      ];
      for (const [args, message] of cases) {
        const res = await callTool(s.access_token, 'editTransaction', args);
        expect(res.isError, JSON.stringify(args)).toBe(true);
        expect(res.text).toContain(message);
      }
      const unchanged = await row(s.vault.id, id);
      expect(unchanged).toMatchObject({ amount: 50, categoryId: null });
    });

    it('links to plan allocations with the same rules as the app', async () => {
      const s = await seed();
      const id = await s.add({
        amount: 1200,
        date: '2026-01-10',
        categoryId: s.food,
        description: 'Parcela',
      });
      const edit = (args: Record<string, unknown>) =>
        callTool(s.access_token, 'editTransaction', { id, ...args });

      const rejected: [Record<string, unknown>, string][] = [
        [
          { allocationId: s.financing, withdrawalType: 'withdrawal' },
          'withdrawalType só se aplica a alocações Reserva',
        ],
        [{ allocationId: s.financing, categoryId: s.food }, 'exclusivas'],
        [{ allocationId: s.trip }, 'precisam de withdrawalType'],
        [
          { allocationId: s.mattress, withdrawalType: 'realization' },
          'não aceitam realização',
        ],
      ];
      for (const [args, message] of rejected) {
        const res = await edit(args);
        expect(res.isError, JSON.stringify(args)).toBe(true);
        expect(res.text).toContain(message);
      }

      // Pagamento: replaces the category and leaves the category budget.
      const payment = await edit({ allocationId: s.financing });
      expect(payment.isError).toBe(false);
      expect(payment.data).toMatchObject({
        allocationId: s.financing,
        category: null,
      });
      expect(await budgetSpent(s.access_token, s.food)).toBe(0);

      // Categorizing a linked transaction must unlink explicitly.
      const linked = await edit({ categoryId: s.food });
      expect(linked.isError).toBe(true);
      expect(linked.text).toContain('allocationId: null');

      const reserve = await edit({
        allocationId: s.trip,
        withdrawalType: 'realization',
      });
      expect(reserve.data.allocationId).toBe(s.trip);
      expect(await row(s.vault.id, id)).toMatchObject({
        allocationId: s.trip,
        withdrawalType: 'realization',
      });
      const withdrawal = await edit({
        allocationId: s.mattress,
        withdrawalType: 'withdrawal',
      });
      expect(withdrawal.isError).toBe(false);

      // Back to a Pagamento: the Reserva withdrawalType does not linger.
      await edit({ allocationId: s.financing });
      expect(await row(s.vault.id, id)).toMatchObject({
        allocationId: s.financing,
        withdrawalType: null,
      });

      const unlinked = await edit({ allocationId: null, categoryId: s.food });
      expect(unlinked.data).toMatchObject({
        allocationId: null,
        category: { id: s.food },
      });
      expect(await row(s.vault.id, id)).toMatchObject({
        allocationId: null,
        withdrawalType: null,
        categoryId: s.food,
      });
      expect(await budgetSpent(s.access_token, s.food)).toBe(1200);
    });

    it('creates, edits and deletes transfers as a pair, and guards single-side edits', async () => {
      const s = await seed();
      const balances = async () => {
        const res = await callTool(s.access_token, 'listEstratos');
        return Object.fromEntries(
          (res.data as { id: string; balance: number }[]).map((e) => [
            e.id,
            e.balance,
          ]),
        );
      };

      const same = await callTool(s.access_token, 'createTransfer', {
        fromEstratoId: s.main,
        toEstratoId: s.main,
        amount: 10,
        date: '2026-01-15',
      });
      expect(same.isError).toBe(true);

      const created = await callTool(s.access_token, 'createTransfer', {
        fromEstratoId: s.main,
        toEstratoId: s.reserve,
        amount: 300,
        date: '2026-01-15',
      });
      expect(created.isError).toBe(false);
      const { transferId } = created.data;
      expect(created.data).toEqual({
        transferId,
        amount: 300,
        date: '2026-01-15',
        fromEstratoId: s.main,
        toEstratoId: s.reserve,
      });
      expect(await balances()).toMatchObject({
        [s.main]: -300,
        [s.reserve]: 300,
      });
      const sideRows = await db
        .select()
        .from(schema.transaction)
        .where(eq(schema.transaction.transferId, transferId));
      const id = sideRows.find((r) => r.type === 'expense')!.id;
      expect(await listed(s.access_token, id)).toMatchObject({
        isTransfer: true,
        transferId,
        estratoId: s.main,
      });

      // Either side, through the single-transaction tools, is refused.
      const sides = sideRows.map((r) => r.id);
      expect(sides).toHaveLength(2);
      for (const side of sides) {
        const edit = await callTool(s.access_token, 'editTransaction', {
          id: side,
          amount: 1,
        });
        expect(edit.isError).toBe(true);
        expect(edit.text).toContain('editTransfer');
        const del = await callTool(s.access_token, 'deleteTransaction', {
          id: side,
        });
        expect(del.isError).toBe(true);
        expect(del.text).toContain('deleteTransfer');
      }
      const categorize = await callTool(
        s.access_token,
        'categorizeTransactions',
        { ids: [id], categoryId: s.food },
      );
      expect(categorize.isError).toBe(true);
      expect(await balances()).toMatchObject({
        [s.main]: -300,
        [s.reserve]: 300,
      });

      expect(
        (await callTool(s.access_token, 'editTransfer', { transferId }))
          .isError,
      ).toBe(true);
      expect(
        (
          await callTool(s.access_token, 'editTransfer', {
            transferId,
            toEstratoId: s.main,
          })
        ).isError,
      ).toBe(true);

      const edited = await callTool(s.access_token, 'editTransfer', {
        transferId,
        amount: 250,
        date: '2026-01-18',
      });
      expect(edited.data).toMatchObject({
        amount: 250,
        date: '2026-01-18',
        fromEstratoId: s.main,
        toEstratoId: s.reserve,
      });
      const pair = await db
        .select()
        .from(schema.transaction)
        .where(eq(schema.transaction.transferId, transferId));
      expect(pair.map((r) => r.amount)).toEqual([250, 250]);
      expect(await balances()).toMatchObject({
        [s.main]: -250,
        [s.reserve]: 250,
      });

      const deleted = await callTool(s.access_token, 'deleteTransfer', {
        transferId,
      });
      expect(deleted.isError).toBe(false);
      expect(await balances()).toMatchObject({ [s.main]: 0, [s.reserve]: 0 });
      expect(
        (await callTool(s.access_token, 'deleteTransfer', { transferId }))
          .isError,
      ).toBe(true);
    });

    it('categorizes in bulk, reporting per-id failures without aborting', async () => {
      const s = await seed();
      const a = await s.add({ amount: 10, date: '2026-01-05' });
      const b = await s.add({
        amount: 20,
        date: '2026-01-06',
        categoryId: s.transport,
      });
      const c = await s.add({ amount: 30, date: '2026-01-07' });
      const planned = await s.add({
        amount: 1200,
        date: '2026-01-08',
        allocationId: s.financing,
      });

      const res = await callTool(s.access_token, 'categorizeTransactions', {
        ids: [a, b, 'nope', c, planned, a],
        categoryId: s.food,
      });
      expect(res.isError).toBe(false);
      expect(res.data.category).toEqual({ id: s.food, name: 'Alimentação' });
      expect(res.data.updated).toEqual([a, b, c]);
      expect(res.data.failed.map((f: { id: string }) => f.id)).toEqual([
        'nope',
        planned,
      ]);
      expect(await budgetSpent(s.access_token, s.food)).toBe(60);
      expect(await budgetSpent(s.access_token, s.transport)).toBe(0);
      expect((await row(s.vault.id, planned))!.categoryId).toBeNull();

      const allFailed = await callTool(
        s.access_token,
        'categorizeTransactions',
        { ids: ['nope'], categoryId: s.food },
      );
      expect(allFailed.isError).toBe(true);
      expect(
        (
          await callTool(s.access_token, 'categorizeTransactions', {
            ids: [a],
            categoryId: crypto.randomUUID(),
          })
        ).isError,
      ).toBe(true);
    });

    it("cannot edit another vault's transactions or use its ids", async () => {
      const mine = await seed();
      const other = await seed();
      const myId = await mine.add({
        amount: 10,
        date: '2026-01-05',
        categoryId: mine.food,
      });
      const otherId = await other.add({
        amount: 99,
        date: '2026-01-05',
        categoryId: other.food,
      });
      const otherTransfer = await callTool(
        other.access_token,
        'createTransfer',
        {
          fromEstratoId: other.main,
          toEstratoId: other.reserve,
          amount: 50,
          date: '2026-01-06',
        },
      );
      const token = mine.access_token;
      const expectError = async (
        tool: string,
        args: Record<string, unknown>,
      ) => {
        const res = await callTool(token, tool, args);
        expect(res.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
        return res;
      };

      // Their transactions and transfers.
      await expectError('editTransaction', { id: otherId, amount: 1 });
      await expectError('deleteTransaction', { id: otherId });
      await expectError('categorizeTransactions', {
        ids: [otherId],
        categoryId: mine.transport,
      });
      const transferId = otherTransfer.data.transferId;
      await expectError('editTransfer', { transferId, amount: 1 });
      await expectError('deleteTransfer', { transferId });

      // Their ids on my transaction.
      await expectError('editTransaction', {
        id: myId,
        categoryId: other.transport,
      });
      await expectError('categorizeTransactions', {
        ids: [myId],
        categoryId: other.transport,
      });
      await expectError('editTransaction', {
        id: myId,
        estratoId: other.reserve,
      });
      const alloc = await expectError('editTransaction', {
        id: myId,
        allocationId: other.financing,
      });
      expect(alloc.text).toContain('não pertence a este vault');
      await expectError('createTransfer', {
        fromEstratoId: mine.main,
        toEstratoId: other.reserve,
        amount: 5,
        date: '2026-01-07',
      });

      expect(await row(other.vault.id, otherId)).toMatchObject({
        amount: 99,
        categoryId: other.food,
      });
      expect(await row(mine.vault.id, myId)).toMatchObject({
        amount: 10,
        categoryId: mine.food,
        boxId: mine.main,
        allocationId: null,
      });
      const pair = await db
        .select()
        .from(schema.transaction)
        .where(eq(schema.transaction.transferId, transferId));
      expect(pair.map((r) => r.amount)).toEqual([50, 50]);
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
        expect(tools.length).toBe(19);

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
