import { describe, it, expect, beforeEach } from 'vitest';
import { PlanQueryService } from './plan-query.service';
import { PlanInMemoryRepository } from '@/plan/repositories/in-memory/plan-in-memory.repository';
import { AllocationInMemoryRepository } from './repositories/in-memory/allocation-in-memory.repository';
import { Plan } from '@/plan/domain/plan';

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
});
