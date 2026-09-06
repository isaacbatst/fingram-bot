/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as schema from '@/shared/persistence/drizzle/schema';
import { INestApplication } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestTransaction,
  createTestVault,
  startTestApp,
  stopTestApp,
  truncateAll,
} from './setup';

const day = (year: number, month: number, dayOfMonth: number) =>
  new Date(Date.UTC(year, month - 1, dayOfMonth));

describe('Activity API (integration)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let vaultToken: string;
  let vaultId: string;

  beforeAll(async () => {
    const result = await startTestApp();
    app = result.app;
    db = result.db;
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const vault = await createTestVault(db);
    vaultToken = vault.token;
    vaultId = vault.id;
  });

  const getActivity = async (weeks?: number) => {
    const url = weeks ? `/vault/activity?weeks=${weeks}` : '/vault/activity';
    const response = await request(app.getHttpServer())
      .get(url)
      .set('Cookie', `vault_access_token=${vaultToken}`);
    expect(response.status).toBe(200);
    return response.body;
  };

  it('should require authentication', async () => {
    const response = await request(app.getHttpServer()).get('/vault/activity');
    expect(response.status).toBe(401);
  });

  it('should group the transactions of a day into one entry', async () => {
    const hoje = new Date();
    const ontem = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - 1),
    );

    await createTestTransaction(db, {
      vaultId,
      amount: 10,
      type: 'expense',
      committed: true,
      date: ontem,
    });
    await createTestTransaction(db, {
      vaultId,
      amount: 20,
      type: 'expense',
      committed: true,
      date: ontem,
    });

    const body = await getActivity();
    const chave = ontem.toISOString().slice(0, 10);
    const dia = body.days.find((d: { date: string }) => d.date === chave);

    expect(dia).toBeDefined();
    expect(dia.count).toBe(2);
    expect(dia.expenseTotal).toBe(30);
  });

  it('should keep the day the transaction was stored on', async () => {
    // A data vai como meia-noite UTC. Se a consulta aplicasse o fuso do servidor
    // (UTC-3), o dia voltaria um — é o erro que o CLAUDE.md do projeto descreve.
    const hoje = new Date();
    const data = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()),
    );
    await createTestTransaction(db, {
      vaultId,
      amount: 45.9,
      type: 'expense',
      committed: true,
      date: data,
    });

    const body = await getActivity();
    const datas = body.days.map((d: { date: string }) => d.date);
    expect(datas).toContain(data.toISOString().slice(0, 10));
  });

  it('should count only committed transactions', async () => {
    const hoje = new Date();
    const data = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()),
    );
    await createTestTransaction(db, {
      vaultId,
      amount: 99,
      type: 'expense',
      committed: false,
      date: data,
    });

    const body = await getActivity();
    expect(body.days).toHaveLength(0);
  });

  it('should sum only expenses in the daily total', async () => {
    const hoje = new Date();
    const data = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()),
    );
    await createTestTransaction(db, {
      vaultId,
      amount: 10,
      type: 'expense',
      committed: true,
      date: data,
    });
    await createTestTransaction(db, {
      vaultId,
      amount: 500,
      type: 'income',
      committed: true,
      date: data,
    });

    const body = await getActivity();
    const dia = body.days[0];
    expect(dia.count).toBe(2);
    expect(dia.expenseTotal).toBe(10);
  });

  it('should leave out what falls before the window', async () => {
    await createTestTransaction(db, {
      vaultId,
      amount: 10,
      type: 'expense',
      committed: true,
      date: day(2020, 1, 1),
    });

    const body = await getActivity(4);
    expect(body.days).toHaveLength(0);
  });

  it('should start the window on a Sunday', async () => {
    const body = await getActivity();
    expect(new Date(body.startDate).getUTCDay()).toBe(0);
  });

  it('should fall back to the default when weeks is nonsense', async () => {
    const body = await getActivity(999);
    const dias = Math.round(
      (new Date(body.endDate).getTime() - new Date(body.startDate).getTime()) /
        86_400_000,
    );
    expect(dias).toBeLessThan(160);
  });
});
