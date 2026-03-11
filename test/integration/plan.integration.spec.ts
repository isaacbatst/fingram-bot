import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import request from 'supertest';
import * as schema from '@/shared/persistence/drizzle/schema';
import {
  startTestApp,
  stopTestApp,
  createTestVault,
  truncateAll,
} from './setup';

describe('Plan API (integration)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let vaultToken: string;

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
  });

  describe('POST /plans', () => {
    it('should create a plan with yieldRate', async () => {
      const res = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Teste Yield',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          boxes: [
            {
              label: 'Reserva',
              target: 0,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              yieldRate: 0.12,
              scheduledPayments: [],
            },
          ],
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.boxes[0].yieldRate).toBe(0.12);
    });

    it('should reject yieldRate on holdsFunds: false box', async () => {
      await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Teste Rejeicao',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          boxes: [
            {
              label: 'Terreno',
              target: 100000,
              monthlyAmount: [{ month: 0, amount: 2000 }],
              holdsFunds: false,
              yieldRate: 0.12,
              scheduledPayments: [],
            },
          ],
        })
        .expect(400);
    });
  });

  describe('GET /plans/:id/projection', () => {
    it('should return projection with yield data', async () => {
      // Create plan
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Teste Projection',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          boxes: [
            {
              label: 'Reserva',
              target: 0,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              yieldRate: 0.12,
              scheduledPayments: [],
            },
          ],
        })
        .expect(201);

      const planId = createRes.body.id;

      // Get projection
      const projRes = await request(app.getHttpServer())
        .get(`/plans/${planId}/projection?months=12`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;
      expect(months).toHaveLength(12);

      // Month 1: deposit 1000 at 12% annual → yield = 1000 * 0.01 = 10
      const month1 = months[0];
      const boxId = Object.keys(month1.boxes)[0];
      expect(month1.boxYields[boxId]).toBeCloseTo(10, 1);
      expect(month1.boxes[boxId]).toBeCloseTo(1010, 0);
      expect(month1.totalYield).toBeCloseTo(10, 1);

      // Month 12: compound effect → balance > 12000
      const month12 = months[11];
      expect(month12.boxes[boxId]).toBeGreaterThan(12000);
      expect(month12.totalYield).toBeGreaterThan(0);
    });

    it('should return projection without yield when yieldRate is absent', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Sem Yield',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          boxes: [
            {
              label: 'Reserva',
              target: 0,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              scheduledPayments: [],
            },
          ],
        })
        .expect(201);

      const projRes = await request(app.getHttpServer())
        .get(`/plans/${createRes.body.id}/projection?months=3`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;
      const boxId = Object.keys(months[0].boxes)[0];

      expect(months[0].boxYields[boxId]).toBe(0);
      expect(months[0].totalYield).toBe(0);
      expect(months[2].boxes[boxId]).toBe(3000);
    });
  });
});
