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

  describe('Financing', () => {
    it('should create a plan with SAC financing and return projection', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Teste Financiamento SAC',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 30000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 15000 }],
          },
          boxes: [
            {
              label: 'Financiamento Casa',
              target: 0,
              monthlyAmount: [],
              holdsFunds: false,
              scheduledPayments: [],
              financing: {
                principal: 120_000,
                annualRate: 0.12,
                termMonths: 12,
                system: 'sac',
              },
            },
          ],
        })
        .expect(201);

      expect(createRes.body.boxes[0].financing).toBeDefined();
      expect(createRes.body.boxes[0].financing.system).toBe('sac');

      const projRes = await request(app.getHttpServer())
        .get(`/plans/${createRes.body.id}/projection?months=13`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;
      const boxId = Object.keys(months[0].boxes)[0];

      // Month 1: SAC amortization
      expect(months[0].financingDetails[boxId].phase).toBe('amortization');
      expect(months[0].financingDetails[boxId].amortization).toBeCloseTo(10_000, 0);
      expect(months[0].financingDetails[boxId].interest).toBeGreaterThan(0);

      // Payments should decline (SAC)
      expect(months[11].financingDetails[boxId].payment).toBeLessThan(
        months[0].financingDetails[boxId].payment,
      );

      // Month 12: should be fully paid
      expect(months[11].financingDetails[boxId].outstandingBalance).toBeCloseTo(0, 0);

      // Month 13: paid_off
      expect(months[12].financingDetails[boxId].phase).toBe('paid_off');
    });

    it('should create a plan with PRICE financing', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Teste PRICE',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 30000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 15000 }],
          },
          boxes: [
            {
              label: 'Carro',
              target: 0,
              monthlyAmount: [],
              holdsFunds: false,
              scheduledPayments: [],
              financing: {
                principal: 60_000,
                annualRate: 0.18,
                termMonths: 24,
                system: 'price',
              },
            },
          ],
        })
        .expect(201);

      const projRes = await request(app.getHttpServer())
        .get(`/plans/${createRes.body.id}/projection?months=24`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;
      const boxId = Object.keys(months[0].boxes)[0];

      // PRICE: constant payments
      const firstPayment = months[0].financingDetails[boxId].payment;
      expect(months[12].financingDetails[boxId].payment).toBeCloseTo(firstPayment, 0);

      // Fully paid at end
      expect(months[23].financingDetails[boxId].outstandingBalance).toBeCloseTo(0, 0);
    });

    it('should reject financing on holdsFunds: true box', async () => {
      await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Invalido',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          boxes: [
            {
              label: 'Errado',
              target: 0,
              monthlyAmount: [],
              holdsFunds: true,
              scheduledPayments: [],
              financing: {
                principal: 100_000,
                annualRate: 0.12,
                termMonths: 120,
                system: 'sac',
              },
            },
          ],
        })
        .expect(400);
    });

    it('should handle construction phase in projection', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Obra',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 50000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 20000 }],
          },
          boxes: [
            {
              label: 'Financiamento Obra',
              target: 0,
              monthlyAmount: [],
              holdsFunds: false,
              scheduledPayments: [],
              financing: {
                principal: 1_200_000,
                annualRate: 0.11,
                termMonths: 420,
                system: 'sac',
                constructionMonths: 16,
              },
            },
          ],
        })
        .expect(201);

      const projRes = await request(app.getHttpServer())
        .get(`/plans/${createRes.body.id}/projection?months=18`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;
      const boxId = Object.keys(months[0].financingDetails)[0];

      // Construction phase: months 0-15
      expect(months[0].financingDetails[boxId].phase).toBe('construction');
      expect(months[0].financingDetails[boxId].amortization).toBe(0);
      expect(months[15].financingDetails[boxId].phase).toBe('construction');

      // Amortization: month 16+
      expect(months[16].financingDetails[boxId].phase).toBe('amortization');
      expect(months[16].financingDetails[boxId].amortization).toBeGreaterThan(0);
    });
  });
});
