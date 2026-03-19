import { describe, it, expect, beforeEach } from 'vitest';
import { PlanQueryService } from './plan-query.service';
import { PlanInMemoryRepository } from '@/plan/repositories/in-memory/plan-in-memory.repository';
import { AllocationInMemoryRepository } from './repositories/in-memory/allocation-in-memory.repository';
import { Plan } from '@/plan/domain/plan';
import { Allocation } from './domain/allocation';

describe('PlanQueryService', () => {
  let service: PlanQueryService;
  let planRepo: PlanInMemoryRepository;
  let allocationRepo: AllocationInMemoryRepository;

  const vaultId = 'vault-1';

  beforeEach(() => {
    planRepo = new PlanInMemoryRepository();
    allocationRepo = new AllocationInMemoryRepository();
    service = new PlanQueryService(planRepo, allocationRepo);
  });

  describe('getActiveCostOfLivingCeiling', () => {
    it('should return the amount from a single change point at month 0', async () => {
      const plan = Plan.create({
        vaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [{ month: 0, amount: 5000 }],
        },
      });
      await planRepo.create(plan);

      const result = await service.getActiveCostOfLivingCeiling(
        vaultId,
        new Date('2026-03-15'),
      );
      expect(result).toBe(5000);
    });

    it('should return first change point when current date is at month 6', async () => {
      const plan = Plan.create({
        vaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [
            { month: 0, amount: 5000 },
            { month: 12, amount: 6000 },
          ],
        },
      });
      await planRepo.create(plan);

      // Month 6 (July 2026) — only first change point (month 0) is active
      const result = await service.getActiveCostOfLivingCeiling(
        vaultId,
        new Date('2026-07-01'),
      );
      expect(result).toBe(5000);
    });

    it('should return second change point when current date is at month 30', async () => {
      const plan = Plan.create({
        vaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [
            { month: 0, amount: 5000 },
            { month: 12, amount: 6000 },
          ],
        },
      });
      await planRepo.create(plan);

      // Month 30 (July 2028) — second change point (month 12) is active
      const result = await service.getActiveCostOfLivingCeiling(
        vaultId,
        new Date('2028-07-01'),
      );
      expect(result).toBe(6000);
    });

    it('should return null when no plans exist', async () => {
      const result = await service.getActiveCostOfLivingCeiling(
        vaultId,
        new Date('2026-03-15'),
      );
      expect(result).toBeNull();
    });

    it('should prefer active plan over draft', async () => {
      const draftPlan = Plan.create({
        vaultId,
        name: 'Draft Plan',
        startDate: new Date('2026-01-01'),
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [{ month: 0, amount: 3000 }],
        },
      });
      await planRepo.create(draftPlan);

      const activePlan = Plan.create({
        vaultId,
        name: 'Active Plan',
        startDate: new Date('2026-01-01'),
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [{ month: 0, amount: 7000 }],
        },
      });
      activePlan.status = 'active';
      await planRepo.create(activePlan);

      const result = await service.getActiveCostOfLivingCeiling(
        vaultId,
        new Date('2026-03-15'),
      );
      expect(result).toBe(7000);
    });
  });

  describe('findMatchingScheduledMovement', () => {
    const createPlanAndAllocation = async (
      overrides: {
        planStartDate?: Date;
        realizationMode?: 'immediate' | 'manual' | 'onCompletion';
        scheduledMovements?: Allocation['scheduledMovements'];
        monthlyAmount?: { month: number; amount: number }[];
        planStatus?: 'draft' | 'active' | 'archived';
      } = {},
    ) => {
      const plan = Plan.create({
        vaultId,
        name: 'Test Plan',
        startDate: overrides.planStartDate ?? new Date('2026-01-01'),
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [{ month: 0, amount: 5000 }],
        },
      });
      if (overrides.planStatus) {
        plan.status = overrides.planStatus;
      }
      await planRepo.create(plan);

      const allocation = Allocation.create({
        planId: plan.id,
        label: 'Terreno',
        target: 100000,
        monthlyAmount: overrides.monthlyAmount ?? [{ month: 0, amount: 2000 }],
        realizationMode: overrides.realizationMode ?? 'immediate',
        scheduledMovements: overrides.scheduledMovements ?? [],
      });
      await allocationRepo.create(allocation);

      return { plan, allocation };
    };

    // Use local-time Date constructors to avoid UTC-to-local timezone shifts
    // that would change the computed plan month
    const planStart = () => new Date(2026, 0, 1); // Jan 1, 2026 local
    const marchDate = () => new Date(2026, 2, 15); // Mar 15, 2026 local (month 2)

    it('exact match with scheduled movement returns suggestion', async () => {
      await createPlanAndAllocation({
        planStartDate: planStart(),
        scheduledMovements: [
          { month: 2, amount: 5000, label: 'Entrada terreno', type: 'in' },
        ],
      });

      // March 2026 = month 2 from plan start
      const result = await service.findMatchingScheduledMovement(
        vaultId,
        5000,
        marchDate(),
      );

      expect(result).not.toBeNull();
      expect(result!.allocationLabel).toBe('Terreno');
      expect(result!.scheduledMovement.amount).toBe(5000);
      expect(result!.scheduledMovement.label).toBe('Entrada terreno');
      expect(result!.divergencePercent).toBe(0);
      expect(result!.divergenceAmount).toBe(0);
    });

    it('within 10% tolerance returns suggestion', async () => {
      await createPlanAndAllocation({
        planStartDate: planStart(),
        scheduledMovements: [
          { month: 2, amount: 5000, label: 'Entrada terreno', type: 'in' },
        ],
      });

      // 4600 is 8% off from 5000 => within 10% tolerance
      const result = await service.findMatchingScheduledMovement(
        vaultId,
        4600,
        marchDate(),
      );

      expect(result).not.toBeNull();
      expect(result!.divergenceAmount).toBe(400);
      expect(result!.divergencePercent).toBe(8);
    });

    it('over tolerance returns null', async () => {
      await createPlanAndAllocation({
        planStartDate: planStart(),
        scheduledMovements: [
          { month: 2, amount: 5000, label: 'Entrada terreno', type: 'in' },
        ],
      });

      // 4000 is 20% off from 5000 => over 10% tolerance (threshold = min(500, 500) = 500, divergence = 1000 > 500)
      const result = await service.findMatchingScheduledMovement(
        vaultId,
        4000,
        marchDate(),
      );

      expect(result).toBeNull();
    });

    it('only matches Pagamento allocations (not Reserva)', async () => {
      await createPlanAndAllocation({
        planStartDate: planStart(),
        realizationMode: 'manual', // Reserva
        scheduledMovements: [
          { month: 2, amount: 5000, label: 'Aporte', type: 'in' },
        ],
      });

      const result = await service.findMatchingScheduledMovement(
        vaultId,
        5000,
        marchDate(),
      );

      expect(result).toBeNull();
    });

    it('matches monthly amount when no scheduled movement', async () => {
      await createPlanAndAllocation({
        planStartDate: planStart(),
        monthlyAmount: [{ month: 0, amount: 2000 }],
        scheduledMovements: [],
      });

      const result = await service.findMatchingScheduledMovement(
        vaultId,
        2000,
        marchDate(),
      );

      expect(result).not.toBeNull();
      expect(result!.scheduledMovement.label).toBe('Parcela mensal');
      expect(result!.scheduledMovement.amount).toBe(2000);
      expect(result!.divergenceAmount).toBe(0);
    });

    it('no plan returns null', async () => {
      const result = await service.findMatchingScheduledMovement(
        vaultId,
        5000,
        marchDate(),
      );

      expect(result).toBeNull();
    });

    it('does not match scheduled movement with type out', async () => {
      await createPlanAndAllocation({
        planStartDate: planStart(),
        scheduledMovements: [
          { month: 2, amount: 5000, label: 'Saída', type: 'out' },
        ],
        monthlyAmount: [], // no monthly so it doesn't match that either
      });

      const result = await service.findMatchingScheduledMovement(
        vaultId,
        5000,
        marchDate(),
      );

      expect(result).toBeNull();
    });

    it('does not match scheduled movement for different month', async () => {
      await createPlanAndAllocation({
        planStartDate: planStart(),
        scheduledMovements: [
          { month: 5, amount: 5000, label: 'Entrada futura', type: 'in' },
        ],
        monthlyAmount: [],
      });

      // March 2026 = month 2, but scheduled movement is for month 5
      const result = await service.findMatchingScheduledMovement(
        vaultId,
        5000,
        marchDate(),
      );

      expect(result).toBeNull();
    });

    it('uses absolute threshold (R$500) when it is smaller than 10%', async () => {
      // For large amounts, 10% is large but R$500 is the cap
      await createPlanAndAllocation({
        planStartDate: planStart(),
        scheduledMovements: [
          {
            month: 2,
            amount: 100000,
            label: 'Pagamento grande',
            type: 'in',
          },
        ],
        monthlyAmount: [],
      });

      // R$100500 divergence = 500 (0.5%) — within R$500 threshold
      const result1 = await service.findMatchingScheduledMovement(
        vaultId,
        100500,
        marchDate(),
      );
      expect(result1).not.toBeNull();

      // R$100600 divergence = 600 — over R$500 threshold (10% = 10000, but min is 500)
      const result2 = await service.findMatchingScheduledMovement(
        vaultId,
        100600,
        marchDate(),
      );
      expect(result2).toBeNull();
    });
  });
});
