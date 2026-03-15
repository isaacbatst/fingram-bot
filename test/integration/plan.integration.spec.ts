import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/shared/persistence/drizzle/schema';
import {
  startTestApp,
  stopTestApp,
  createTestVault,
  createTestAllocation,
  truncateAll,
  createTestTransaction,
} from './setup';

describe('Plan API (integration)', () => {
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
          allocations: [
            {
              label: 'Reserva',
              target: 0,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              yieldRate: 0.12,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.allocations).toHaveLength(1);
      expect(res.body.allocations[0].yieldRate).toBe(0.12);
    });

    it('should reject yieldRate on holdsFunds: false allocation', async () => {
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
          allocations: [
            {
              label: 'Terreno',
              target: 100000,
              monthlyAmount: [{ month: 0, amount: 2000 }],
              holdsFunds: false,
              yieldRate: 0.12,
              scheduledMovements: [],
            },
          ],
        })
        .expect(400);
    });
  });

  describe('GET /plans/:id/projection', () => {
    // Use a future start date to ensure all months use premissas (no hybrid)
    const futureStartDate = new Date(
      Date.UTC(new Date().getFullYear() + 1, 0, 1),
    ).toISOString();

    it('should return projection with yield data', async () => {
      // Create plan
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Teste Projection',
          startDate: futureStartDate,
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Reserva',
              target: 0,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              yieldRate: 0.12,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const planId = createRes.body.id;
      const allocationId = createRes.body.allocations[0].id;

      // Get projection
      const projRes = await request(app.getHttpServer())
        .get(`/plans/${planId}/projection?months=12`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;
      expect(months).toHaveLength(12);

      // Month 0: deposit 1000 at 12% annual -> yield = 1000 * 0.01 = 10
      const month0 = months[0];
      expect(month0.allocationYields[allocationId]).toBeCloseTo(10, 1);
      expect(month0.allocations[allocationId]).toBeCloseTo(1010, 0);
      expect(month0.totalYield).toBeCloseTo(10, 1);
      expect(month0.isReal).toBe(false); // future plan, all projected

      // Month 11: compound effect -> balance > 12000
      const month11 = months[11];
      expect(month11.allocations[allocationId]).toBeGreaterThan(12000);
      expect(month11.totalYield).toBeGreaterThan(0);
    });

    it('should return projection without yield when yieldRate is absent', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Sem Yield',
          startDate: futureStartDate,
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Reserva',
              target: 0,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const allocationId = createRes.body.allocations[0].id;

      const projRes = await request(app.getHttpServer())
        .get(`/plans/${createRes.body.id}/projection?months=3`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;

      expect(months[0].allocationYields[allocationId]).toBe(0);
      expect(months[0].totalYield).toBe(0);
      expect(months[2].allocations[allocationId]).toBe(3000);
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
          allocations: [
            {
              label: 'Financiamento Casa',
              target: 0,
              monthlyAmount: [],
              holdsFunds: false,
              scheduledMovements: [],
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

      const allocationId = createRes.body.allocations[0].id;
      expect(createRes.body.allocations[0].financing).toBeDefined();
      expect(createRes.body.allocations[0].financing.system).toBe('sac');

      const projRes = await request(app.getHttpServer())
        .get(`/plans/${createRes.body.id}/projection?months=13`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;

      // Month 0: SAC amortization
      expect(months[0].financingDetails[allocationId].phase).toBe(
        'amortization',
      );
      expect(
        months[0].financingDetails[allocationId].amortization,
      ).toBeCloseTo(10_000, 0);
      expect(
        months[0].financingDetails[allocationId].interest,
      ).toBeGreaterThan(0);

      // Payments should decline (SAC)
      expect(months[11].financingDetails[allocationId].payment).toBeLessThan(
        months[0].financingDetails[allocationId].payment,
      );

      // Month 11: should be fully paid
      expect(
        months[11].financingDetails[allocationId].outstandingBalance,
      ).toBeCloseTo(0, 0);

      // Month 12: paid_off
      expect(months[12].financingDetails[allocationId].phase).toBe('paid_off');
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
          allocations: [
            {
              label: 'Carro',
              target: 0,
              monthlyAmount: [],
              holdsFunds: false,
              scheduledMovements: [],
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

      const allocationId = createRes.body.allocations[0].id;

      const projRes = await request(app.getHttpServer())
        .get(`/plans/${createRes.body.id}/projection?months=24`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;

      // PRICE: constant payments
      const firstPayment = months[0].financingDetails[allocationId].payment;
      expect(months[12].financingDetails[allocationId].payment).toBeCloseTo(
        firstPayment,
        0,
      );

      // Fully paid at end
      expect(
        months[23].financingDetails[allocationId].outstandingBalance,
      ).toBeCloseTo(0, 0);
    });

    it('should reject financing on holdsFunds: true allocation', async () => {
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
          allocations: [
            {
              label: 'Errado',
              target: 0,
              monthlyAmount: [],
              holdsFunds: true,
              scheduledMovements: [],
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
          allocations: [
            {
              label: 'Financiamento Obra',
              target: 0,
              monthlyAmount: [],
              holdsFunds: false,
              scheduledMovements: [],
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

      const allocationId = createRes.body.allocations[0].id;

      const projRes = await request(app.getHttpServer())
        .get(`/plans/${createRes.body.id}/projection?months=18`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;

      // Construction phase: months 0-15
      expect(months[0].financingDetails[allocationId].phase).toBe(
        'construction',
      );
      expect(months[0].financingDetails[allocationId].amortization).toBe(0);
      expect(months[15].financingDetails[allocationId].phase).toBe(
        'construction',
      );

      // Amortization: month 16+
      expect(months[16].financingDetails[allocationId].phase).toBe(
        'amortization',
      );
      expect(
        months[16].financingDetails[allocationId].amortization,
      ).toBeGreaterThan(0);
    });
  });

  describe('Binding', () => {
    it('should bind Reserva allocation to saving box', async () => {
      // Create a plan with a Reserva allocation
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Plano Binding',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Reserva',
              target: 50000,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const planId = createRes.body.id;
      const allocationId = createRes.body.allocations[0].id;

      // Create a saving box directly in the DB
      const boxId = crypto.randomUUID();
      await db.insert(schema.box).values({
        id: boxId,
        vaultId,
        name: 'Reserva Estrato',
        type: 'saving',
        isDefault: false,
        createdAt: new Date(),
      });

      // Bind allocation to the saving box
      const bindRes = await request(app.getHttpServer())
        .patch(`/plans/${planId}/allocations/${allocationId}`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({ estratoId: boxId })
        .expect(200);

      expect(bindRes.body.estratoId).toBe(boxId);
    });

    it('should reject binding Pagamento allocation to box', async () => {
      // Create a plan with a Pagamento allocation (holdsFunds: false)
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Plano Pagamento',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Terreno',
              target: 100000,
              monthlyAmount: [{ month: 0, amount: 2000 }],
              holdsFunds: false,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const planId = createRes.body.id;
      const allocationId = createRes.body.allocations[0].id;

      // Create a saving box
      const boxId = crypto.randomUUID();
      await db.insert(schema.box).values({
        id: boxId,
        vaultId,
        name: 'Saving Box',
        type: 'saving',
        isDefault: false,
        createdAt: new Date(),
      });

      // Attempt to bind should fail
      await request(app.getHttpServer())
        .patch(`/plans/${planId}/allocations/${allocationId}`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({ estratoId: boxId })
        .expect(400);
    });

    it('should unbind allocation', async () => {
      // Create plan with Reserva allocation
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Plano Unbind',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Reserva',
              target: 50000,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const planId = createRes.body.id;
      const allocationId = createRes.body.allocations[0].id;

      // Create a saving box and bind
      const boxId = crypto.randomUUID();
      await db.insert(schema.box).values({
        id: boxId,
        vaultId,
        name: 'Reserva Estrato',
        type: 'saving',
        isDefault: false,
        createdAt: new Date(),
      });

      await request(app.getHttpServer())
        .patch(`/plans/${planId}/allocations/${allocationId}`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({ estratoId: boxId })
        .expect(200);

      // Unbind
      const unbindRes = await request(app.getHttpServer())
        .patch(`/plans/${planId}/allocations/${allocationId}`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({ estratoId: null })
        .expect(200);

      expect(unbindRes.body.estratoId).toBeNull();
    });

    it('should reject binding to spending box', async () => {
      // Create plan with Reserva allocation
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Plano Spending',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Reserva',
              target: 50000,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const planId = createRes.body.id;
      const allocationId = createRes.body.allocations[0].id;

      // Create a spending box
      const boxId = crypto.randomUUID();
      await db.insert(schema.box).values({
        id: boxId,
        vaultId,
        name: 'Spending Box',
        type: 'spending',
        isDefault: false,
        createdAt: new Date(),
      });

      // Attempt to bind to spending box should fail
      await request(app.getHttpServer())
        .patch(`/plans/${planId}/allocations/${allocationId}`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({ estratoId: boxId })
        .expect(400);
    });
  });

  describe('Allocation schema', () => {
    it('CASCADE: deleting plan should delete allocations', async () => {
      // Create plan with allocation
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Plano Cascade',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Reserva',
              target: 50000,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const planId = createRes.body.id;
      const allocationId = createRes.body.allocations[0].id;

      // Verify allocation exists
      const before = await db
        .select()
        .from(schema.allocation)
        .where(eq(schema.allocation.id, allocationId));
      expect(before).toHaveLength(1);

      // Delete plan
      await request(app.getHttpServer())
        .delete(`/plans/${planId}`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      // Allocation should be gone
      const after = await db
        .select()
        .from(schema.allocation)
        .where(eq(schema.allocation.id, allocationId));
      expect(after).toHaveLength(0);
    });

    it('SET NULL: deleting allocation should null out transaction allocationId', async () => {
      // Create plan with allocation
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Plano SetNull',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Reserva',
              target: 50000,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const allocationId = createRes.body.allocations[0].id;

      // Create a transaction referencing the allocation
      const txId = crypto.randomUUID();
      await db.insert(schema.transaction).values({
        id: txId,
        code: 'TEST',
        amount: 100,
        type: 'expense',
        vaultId,
        createdAt: new Date(),
        allocationId,
      });

      // Verify transaction has allocationId
      const txBefore = await db
        .select()
        .from(schema.transaction)
        .where(eq(schema.transaction.id, txId));
      expect(txBefore[0].allocationId).toBe(allocationId);

      // Delete allocation directly from DB
      await db
        .delete(schema.allocation)
        .where(eq(schema.allocation.id, allocationId));

      // Transaction should have allocationId = null
      const txAfter = await db
        .select()
        .from(schema.transaction)
        .where(eq(schema.transaction.id, txId));
      expect(txAfter[0].allocationId).toBeNull();
    });

    it('UNIQUE: two allocations cannot bind to same estrato', async () => {
      // Create plan with two Reserva allocations
      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Plano Unique',
          startDate: '2026-01-01',
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Reserva A',
              target: 25000,
              monthlyAmount: [{ month: 0, amount: 500 }],
              holdsFunds: true,
              scheduledMovements: [],
            },
            {
              label: 'Reserva B',
              target: 25000,
              monthlyAmount: [{ month: 0, amount: 500 }],
              holdsFunds: true,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const planId = createRes.body.id;
      const allocationA = createRes.body.allocations[0].id;
      const allocationB = createRes.body.allocations[1].id;

      // Create a saving box
      const boxId = crypto.randomUUID();
      await db.insert(schema.box).values({
        id: boxId,
        vaultId,
        name: 'Saving Box',
        type: 'saving',
        isDefault: false,
        createdAt: new Date(),
      });

      // Bind allocation A to the box
      await request(app.getHttpServer())
        .patch(`/plans/${planId}/allocations/${allocationA}`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({ estratoId: boxId })
        .expect(200);

      // Binding allocation B to the same box should fail (unique constraint)
      const res = await request(app.getHttpServer())
        .patch(`/plans/${planId}/allocations/${allocationB}`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({ estratoId: boxId });

      // Should fail - either 400 (if service catches) or 500 (if DB constraint)
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Transaction tagging (ISA-99)', () => {
    /** Helper: create a plan with one Pagamento and one Reserva allocation */
    async function createPlanWithAllocations(token: string) {
      const res = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${token}`)
        .send({
          name: 'Test Plan',
          startDate: new Date().toISOString(),
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 5000 }],
          },
          allocations: [
            {
              label: 'Terreno',
              target: 100000,
              monthlyAmount: [{ month: 0, amount: 2000 }],
              holdsFunds: false,
              scheduledMovements: [],
            },
            {
              label: 'Reserva',
              target: 50000,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              holdsFunds: true,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const pagamentoAllocation = res.body.allocations.find(
        (a: any) => !a.holdsFunds,
      );
      const reservaAllocation = res.body.allocations.find(
        (a: any) => a.holdsFunds,
      );

      return {
        planId: res.body.id as string,
        pagamentoAllocationId: pagamentoAllocation.id as string,
        reservaAllocationId: reservaAllocation.id as string,
      };
    }

    it('should create transaction with Pagamento allocationId', async () => {
      const { pagamentoAllocationId } =
        await createPlanWithAllocations(vaultToken);

      const txRes = await request(app.getHttpServer())
        .post('/vault/create-transaction')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          amount: 2000,
          type: 'expense',
          description: 'Parcela terreno',
          allocationId: pagamentoAllocationId,
        })
        .expect(201);

      expect(txRes.body.transaction.allocationId).toBe(pagamentoAllocationId);
    });

    it('should reject transaction with Reserva (holdsFunds) allocationId', async () => {
      const { reservaAllocationId } =
        await createPlanWithAllocations(vaultToken);

      await request(app.getHttpServer())
        .post('/vault/create-transaction')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          amount: 1000,
          type: 'expense',
          description: 'Depósito reserva',
          allocationId: reservaAllocationId,
        })
        .expect(400);
    });

    it('should reject transaction with allocationId from another vault', async () => {
      // Create a second vault and a plan in it
      const vault2 = await createTestVault(db);
      const { pagamentoAllocationId: otherVaultAllocationId } =
        await createPlanWithAllocations(vault2.token);

      // Try to use vault2's allocationId from vault1's token
      await request(app.getHttpServer())
        .post('/vault/create-transaction')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          amount: 2000,
          type: 'expense',
          description: 'Cross-vault attempt',
          allocationId: otherVaultAllocationId,
        })
        .expect(400);
    });

    it('should edit transaction to add allocationId', async () => {
      const { pagamentoAllocationId } =
        await createPlanWithAllocations(vaultToken);

      // Create transaction without allocationId
      const txRes = await request(app.getHttpServer())
        .post('/vault/create-transaction')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          amount: 2000,
          type: 'expense',
          description: 'Sem alocação inicial',
        })
        .expect(201);

      const txCode = txRes.body.transaction.code;
      expect(txRes.body.transaction.allocationId).toBeFalsy();

      // Edit to add allocationId
      const editRes = await request(app.getHttpServer())
        .post('/vault/edit-transaction')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          transactionCode: txCode,
          newAllocationId: pagamentoAllocationId,
        })
        .expect(201);

      expect(editRes.body.transaction.allocationId).toBe(pagamentoAllocationId);
    });

    it('should edit transaction to remove allocationId', async () => {
      const { pagamentoAllocationId } =
        await createPlanWithAllocations(vaultToken);

      // Create transaction with allocationId
      const txRes = await request(app.getHttpServer())
        .post('/vault/create-transaction')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          amount: 2000,
          type: 'expense',
          description: 'Com alocação',
          allocationId: pagamentoAllocationId,
        })
        .expect(201);

      const txCode = txRes.body.transaction.code;
      expect(txRes.body.transaction.allocationId).toBe(pagamentoAllocationId);

      // Edit to remove allocationId
      const editRes = await request(app.getHttpServer())
        .post('/vault/edit-transaction')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          transactionCode: txCode,
          newAllocationId: null,
        })
        .expect(201);

      expect(editRes.body.transaction.allocationId).toBeNull();
    });

    it('GET /plans/allocations?type=payment returns only Pagamento allocations', async () => {
      await createPlanWithAllocations(vaultToken);

      const res = await request(app.getHttpServer())
        .get('/plans/allocations?type=payment')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      // All returned allocations must be Pagamento (holdsFunds === false)
      for (const alloc of res.body) {
        expect(alloc.holdsFunds).toBe(false);
      }
    });
  });

  describe('GET /vault/budget-ceiling', () => {
    it('should return ceiling=null when no plan exists', async () => {
      const res = await request(app.getHttpServer())
        .get('/vault/budget-ceiling')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      expect(res.body.ceiling).toBeNull();
      expect(res.body.allocated).toBe(0);
      expect(res.body.buffer).toBeNull();
      expect(res.body.overBudget).toBe(false);
    });

    it('should return ceiling with allocated=0 when plan exists but no budgets', async () => {
      // Create a plan
      await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Budget Ceiling Plan',
          startDate: new Date().toISOString(),
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/vault/budget-ceiling')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      expect(res.body.ceiling).toBe(6000);
      expect(res.body.allocated).toBe(0);
      expect(res.body.buffer).toBe(6000);
      expect(res.body.overBudget).toBe(false);
    });

    it('should return correct ceiling, allocated, and buffer with budgets', async () => {
      // Create a plan
      await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Budget Ceiling Plan',
          startDate: new Date().toISOString(),
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [],
        })
        .expect(201);

      // Get categories to set budgets
      const catRes = await request(app.getHttpServer())
        .get('/vault/categories')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const categories = catRes.body;
      // Set budgets for first two categories
      const budgets = categories.slice(0, 2).map((c: any, i: number) => ({
        categoryCode: c.code,
        amount: (i + 1) * 1000, // 1000 and 2000
      }));

      await request(app.getHttpServer())
        .post('/vault/set-budgets')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({ budgets })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/vault/budget-ceiling')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      expect(res.body.ceiling).toBe(6000);
      expect(res.body.allocated).toBe(3000);
      expect(res.body.buffer).toBe(3000);
      expect(res.body.overBudget).toBe(false);
    });

    it('should return overBudget=true when allocated exceeds ceiling', async () => {
      // Create a plan with low ceiling
      await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Low Ceiling Plan',
          startDate: new Date().toISOString(),
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 2000 }],
          },
          allocations: [],
        })
        .expect(201);

      // Get categories to set budgets
      const catRes = await request(app.getHttpServer())
        .get('/vault/categories')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const categories = catRes.body;
      // Set a budget that exceeds the ceiling
      const budgets = categories.slice(0, 2).map((c: any, i: number) => ({
        categoryCode: c.code,
        amount: (i + 1) * 1500, // 1500 + 3000 = 4500 > 2000
      }));

      await request(app.getHttpServer())
        .post('/vault/set-budgets')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({ budgets })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/vault/budget-ceiling')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      expect(res.body.ceiling).toBe(2000);
      expect(res.body.allocated).toBe(4500);
      expect(res.body.buffer).toBe(-2500);
      expect(res.body.overBudget).toBe(true);
    });
  });

  describe('Hybrid projection (ISA-101)', () => {
    it('should use real transaction data for past months and premissas for future', async () => {
      // Create plan starting 2 months ago
      const now = new Date();
      const startDate = new Date(
        Date.UTC(now.getFullYear(), now.getMonth() - 2, 1),
      );

      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'Hybrid Test',
          startDate: startDate.toISOString(),
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [
            {
              label: 'Terreno',
              target: 100000,
              monthlyAmount: [{ month: 0, amount: 2000 }],
              holdsFunds: false,
              scheduledMovements: [],
            },
          ],
        })
        .expect(201);

      const planId = createRes.body.id;
      const allocationId = createRes.body.allocations[0].id;

      // Create committed transactions in month 0 (2 months ago)
      const month0Start = new Date(
        Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 15),
      );

      // Income: 12000
      await createTestTransaction(db, {
        vaultId,
        amount: 12000,
        type: 'income',
        date: month0Start,
        committed: true,
      });

      // Expense (cost of living): 7000
      await createTestTransaction(db, {
        vaultId,
        amount: 7000,
        type: 'expense',
        date: month0Start,
        committed: true,
      });

      // Expense tagged with allocation: 3000
      await createTestTransaction(db, {
        vaultId,
        amount: 3000,
        type: 'expense',
        date: month0Start,
        committed: true,
        allocationId,
      });

      // Get projection
      const projRes = await request(app.getHttpServer())
        .get(`/plans/${planId}/projection?months=6`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;
      expect(months).toHaveLength(6);

      // Month 0: real data
      // realIncome = 12000 (total income, no linked estratos)
      // realCostOfLiving = 7000 (expenses - tagged expenses - transfer expenses)
      // Tagged expense = 3000 is not counted as cost of living
      expect(months[0].isReal).toBe(true);
      expect(months[0].income).toBe(12000);
      expect(months[0].costOfLiving).toBe(7000);
      expect(months[0].allocationPayments[allocationId]).toBe(3000);

      // Month 2 (current month): projected
      expect(months[2].isReal).toBe(false);
      expect(months[2].income).toBe(10000);
      expect(months[2].costOfLiving).toBe(6000);
    });

    it('projection without transactions should still work with isReal for past months', async () => {
      // Create plan starting 1 month ago with no transactions
      const now = new Date();
      const startDate = new Date(
        Date.UTC(now.getFullYear(), now.getMonth() - 1, 1),
      );

      const createRes = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          name: 'No Transactions',
          startDate: startDate.toISOString(),
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
          },
          allocations: [],
        })
        .expect(201);

      const projRes = await request(app.getHttpServer())
        .get(`/plans/${createRes.body.id}/projection?months=3`)
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      const months = projRes.body;

      // Month 0: real (past) but with zeroed real data
      expect(months[0].isReal).toBe(true);
      expect(months[0].income).toBe(0);
      expect(months[0].costOfLiving).toBe(0);

      // Month 1: projected (current month)
      expect(months[1].isReal).toBe(false);
      expect(months[1].income).toBe(10000);
    });
  });

  describe('Allocation suggestion (ISA-102)', () => {
    /**
     * Helper: create a plan with a Pagamento allocation that has a scheduled
     * movement in the current plan month (month 0 from now).
     */
    async function createPlanWithScheduledMovement(
      token: string,
      opts: {
        scheduledMovements?: any[];
        monthlyAmount?: any[];
        holdsFunds?: boolean;
      } = {},
    ) {
      const now = new Date();
      // Use day 15 to avoid UTC-to-local timezone shifts changing the month
      const startDate = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), 15),
      );

      const res = await request(app.getHttpServer())
        .post('/plans')
        .set('Cookie', `vault_access_token=${token}`)
        .send({
          name: 'Suggestion Plan',
          startDate: startDate.toISOString(),
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 5000 }],
          },
          allocations: [
            {
              label: 'Terreno',
              target: 100000,
              monthlyAmount: opts.monthlyAmount ?? [
                { month: 0, amount: 2000 },
              ],
              holdsFunds: opts.holdsFunds ?? false,
              scheduledMovements: opts.scheduledMovements ?? [
                {
                  month: 0,
                  amount: 5000,
                  label: 'Entrada terreno',
                  type: 'in',
                },
              ],
            },
          ],
        })
        .expect(201);

      return {
        planId: res.body.id as string,
        allocationId: res.body.allocations[0].id as string,
      };
    }

    it('GET /vault/suggest-allocation returns match for scheduled movement', async () => {
      await createPlanWithScheduledMovement(vaultToken);

      const res = await request(app.getHttpServer())
        .get('/vault/suggest-allocation?amount=5000')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      expect(res.body.suggestion).not.toBeNull();
      expect(res.body.suggestion.allocationLabel).toBe('Terreno');
      expect(res.body.suggestion.scheduledMovement.amount).toBe(5000);
      expect(res.body.suggestion.divergenceAmount).toBe(0);
    });

    it('GET /vault/suggest-allocation returns null when no match', async () => {
      await createPlanWithScheduledMovement(vaultToken);

      // Amount completely off
      const res = await request(app.getHttpServer())
        .get('/vault/suggest-allocation?amount=99999')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      expect(res.body.suggestion).toBeNull();
    });

    it('GET /vault/suggest-allocation returns null for invalid amount', async () => {
      const res = await request(app.getHttpServer())
        .get('/vault/suggest-allocation?amount=abc')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      expect(res.body.suggestion).toBeNull();
    });

    it('POST /vault/create-transaction returns suggestion when amount matches', async () => {
      await createPlanWithScheduledMovement(vaultToken);

      const res = await request(app.getHttpServer())
        .post('/vault/create-transaction')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          amount: 5000,
          type: 'expense',
          description: 'Pagamento terreno',
        })
        .expect(201);

      expect(res.body.suggestion).not.toBeNull();
      expect(res.body.suggestion.allocationLabel).toBe('Terreno');
      expect(res.body.suggestion.scheduledMovement.amount).toBe(5000);
    });

    it('POST /vault/create-transaction does not return suggestion when allocationId is set', async () => {
      const { allocationId } =
        await createPlanWithScheduledMovement(vaultToken);

      const res = await request(app.getHttpServer())
        .post('/vault/create-transaction')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          amount: 5000,
          type: 'expense',
          description: 'Pagamento terreno',
          allocationId,
        })
        .expect(201);

      expect(res.body.suggestion).toBeNull();
    });

    it('POST /vault/create-transaction does not return suggestion for income', async () => {
      await createPlanWithScheduledMovement(vaultToken);

      const res = await request(app.getHttpServer())
        .post('/vault/create-transaction')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .send({
          amount: 5000,
          type: 'income',
          description: 'Salário',
        })
        .expect(201);

      expect(res.body.suggestion).toBeNull();
    });

    it('GET /vault/suggest-allocation matches monthly amount', async () => {
      await createPlanWithScheduledMovement(vaultToken, {
        scheduledMovements: [],
        monthlyAmount: [{ month: 0, amount: 3000 }],
      });

      const res = await request(app.getHttpServer())
        .get('/vault/suggest-allocation?amount=3000')
        .set('Cookie', `vault_access_token=${vaultToken}`)
        .expect(200);

      expect(res.body.suggestion).not.toBeNull();
      expect(res.body.suggestion.scheduledMovement.label).toBe(
        'Parcela mensal',
      );
      expect(res.body.suggestion.scheduledMovement.amount).toBe(3000);
    });
  });
});
