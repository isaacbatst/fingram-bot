import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlanService } from './plan.service';
import { PlanInMemoryRepository } from './repositories/in-memory/plan-in-memory.repository';
import { AllocationInMemoryRepository } from './shared/repositories/in-memory/allocation-in-memory.repository';
import { PlanQueryService } from './shared/plan-query.service';
import { VaultQueryService } from '@/vault/shared/vault-query.service';
import { Premises } from './domain/plan';

describe('PlanService', () => {
  let service: PlanService;
  let planRepository: PlanInMemoryRepository;
  let allocationRepository: AllocationInMemoryRepository;
  let planQueryService: PlanQueryService;
  let vaultQueryService: VaultQueryService;

  const testVaultId = 'vault-1';

  const defaultPremises: Premises = {
    salaryChangePoints: [{ month: 0, amount: 10000 }],
    costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
  };

  beforeEach(() => {
    planRepository = new PlanInMemoryRepository();
    allocationRepository = new AllocationInMemoryRepository();
    planQueryService = new PlanQueryService(
      planRepository,
      allocationRepository,
    );
    vaultQueryService = {
      findBoxById: vi.fn().mockResolvedValue({
        id: 'box-1',
        name: 'Emergência',
        type: 'saving',
        balance: 0,
        goalAmount: 50000,
        vaultId: testVaultId,
      }),
      listSavingBoxes: vi.fn().mockResolvedValue([]),
      aggregateByPeriod: vi.fn().mockResolvedValue([]),
    } as unknown as VaultQueryService;
    service = new PlanService(
      planRepository,
      allocationRepository,
      planQueryService,
      vaultQueryService,
    );
  });

  describe('create', () => {
    it('should create a plan in draft status', async () => {
      const [error, result] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      expect(error).toBeNull();
      expect(result!.plan.name).toBe('My Plan');
      expect(result!.plan.status).toBe('draft');
      expect(result!.plan.vaultId).toBe('vault-1');
      expect(result!.plan.premises).toEqual(defaultPremises);
      expect(result!.allocations).toHaveLength(0);
    });

    it('should persist the plan in the repository', async () => {
      const [, result] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      const found = await planRepository.findById(result!.plan.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(result!.plan.id);
    });

    it('should reject empty name', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: '  ',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      expect(error).toBe('Nome do plano é obrigatório');
    });

    it('should reject empty salary change points', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: {
          salaryChangePoints: [],
          costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
        },
      });

      expect(error).toBe(
        'Premissas devem ter pelo menos um change point de salário',
      );
    });

    it('should reject empty cost of living change points', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: {
          salaryChangePoints: [{ month: 0, amount: 10000 }],
          costOfLivingChangePoints: [],
        },
      });

      expect(error).toBe(
        'Premissas devem ter pelo menos um change point de custo de vida',
      );
    });

    it('should reject negative salary change point amount', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: {
          salaryChangePoints: [{ month: 0, amount: -1000 }],
          costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
        },
      });

      expect(error).toBe(
        'Valor do change point de salário não pode ser negativo',
      );
    });

    it('should create plan with allocations', async () => {
      const [error, result] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan with Allocations',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        allocations: [
          {
            label: 'Emergency Fund',
            target: 30000,
            monthlyAmount: [{ month: 0, amount: 1000 }],
            realizationMode: 'manual' as const,
            scheduledMovements: [],
          },
        ],
      });

      expect(error).toBeNull();
      expect(result!.allocations).toHaveLength(1);
      expect(result!.allocations[0].label).toBe('Emergency Fund');
      expect(result!.allocations[0].planId).toBe(result!.plan.id);
    });

    it('should create plan with no allocations (just premises)', async () => {
      const [error, result] = await service.create({
        vaultId: 'vault-1',
        name: 'Minimal Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      expect(error).toBeNull();
      expect(result).not.toBeNull();
      expect(result!.allocations).toHaveLength(0);
    });
  });

  describe('getById', () => {
    it('should return plan with allocations when vault matches', async () => {
      const [, createResult] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        allocations: [
          {
            label: 'Savings',
            target: 10000,
            monthlyAmount: [{ month: 0, amount: 500 }],
            realizationMode: 'manual' as const,
            scheduledMovements: [],
          },
        ],
      });

      const [error, result] = await service.getById(
        createResult!.plan.id,
        'vault-1',
      );
      expect(error).toBeNull();
      expect(result!.plan.id).toBe(createResult!.plan.id);
      expect(result!.allocations).toHaveLength(1);
    });

    it('should return error when plan not found', async () => {
      const [error] = await service.getById('nonexistent', 'vault-1');
      expect(error).toBe('Plano não encontrado');
    });

    it('should return error when vault does not match', async () => {
      const [, createResult] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      const [error] = await service.getById(createResult!.plan.id, 'vault-2');
      expect(error).toBe('Plano não encontrado');
    });
  });

  describe('getProjection', () => {
    it('should return projection for a plan', async () => {
      const [, createResult] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      const [error, projection] = await service.getProjection(
        createResult!.plan.id,
        'vault-1',
        12,
      );

      expect(error).toBeNull();
      expect(projection).toHaveLength(12);
      expect(projection![0].month).toBe(0);
      expect(projection![0].income).toBe(10000);
      expect(projection![0].costOfLiving).toBe(6000);
      // With no allocations, surplus = income - costOfLiving = 4000
      expect(projection![0].surplus).toBe(4000);
    });

    it('should include allocations in projection', async () => {
      const [, createResult] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        allocations: [
          {
            label: 'Emergency Fund',
            target: 30000,
            monthlyAmount: [{ month: 0, amount: 1000 }],
            realizationMode: 'manual' as const,
            scheduledMovements: [],
          },
        ],
      });

      const [error, projection] = await service.getProjection(
        createResult!.plan.id,
        'vault-1',
        12,
      );

      expect(error).toBeNull();
      expect(projection).toHaveLength(12);
      // surplus = income - costOfLiving - allocationOutflows = 10000 - 6000 - 1000 = 3000
      expect(projection![0].surplus).toBe(3000);
    });

    it('should return error when plan not found', async () => {
      const [error] = await service.getProjection('nonexistent', 'vault-1');
      expect(error).toBe('Plano não encontrado');
    });

    it('should return error when vault does not match', async () => {
      const [, createResult] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      const [error] = await service.getProjection(
        createResult!.plan.id,
        'vault-2',
      );
      expect(error).toBe('Plano não encontrado');
    });

    it('should default to 120 months', async () => {
      const [, createResult] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      const [, projection] = await service.getProjection(
        createResult!.plan.id,
        'vault-1',
      );

      expect(projection).toHaveLength(120);
    });
  });

  describe('delete', () => {
    it('should delete a plan when vault matches', async () => {
      const [, createResult] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      const [error] = await service.delete(createResult!.plan.id, 'vault-1');
      expect(error).toBeNull();

      const found = await planRepository.findById(createResult!.plan.id);
      expect(found).toBeNull();
    });

    it('should return error when vault does not match', async () => {
      const [, createResult] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      const [error] = await service.delete(createResult!.plan.id, 'vault-2');
      expect(error).toBe('Plano não encontrado');

      // Plan should still exist
      const found = await planRepository.findById(createResult!.plan.id);
      expect(found).not.toBeNull();
    });
  });

  describe('getByVaultId', () => {
    it('should return all plans for a vault', async () => {
      await service.create({
        vaultId: 'vault-1',
        name: 'Plan A',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });

      await service.create({
        vaultId: 'vault-1',
        name: 'Plan B',
        startDate: new Date('2026-02-01'),
        premises: defaultPremises,
      });

      await service.create({
        vaultId: 'vault-2',
        name: 'Plan C',
        startDate: new Date('2026-03-01'),
        premises: defaultPremises,
      });

      const plans = await service.getByVaultId('vault-1');
      expect(plans).toHaveLength(2);
      expect(plans.map((p) => p.name).sort()).toEqual(['Plan A', 'Plan B']);
    });

    it('should return empty array when no plans exist', async () => {
      const plans = await service.getByVaultId('vault-nonexistent');
      expect(plans).toHaveLength(0);
    });
  });

  describe('updatePremises', () => {
    it('should update salary change points', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const newPremises = {
        salaryChangePoints: [
          { month: 0, amount: 10000 },
          { month: 6, amount: 12000 },
        ],
      };
      const [error, result] = await service.updatePremises(
        created!.plan.id,
        testVaultId,
        newPremises,
      );
      expect(error).toBeNull();
      expect(result!.premises.salaryChangePoints).toEqual(
        newPremises.salaryChangePoints,
      );
      expect(result!.premises.costOfLivingChangePoints).toEqual(
        defaultPremises.costOfLivingChangePoints,
      );
    });

    it('should update cost of living change points', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const newPremises = {
        costOfLivingChangePoints: [
          { month: 0, amount: 6000 },
          { month: 12, amount: 7000 },
        ],
      };
      const [error, result] = await service.updatePremises(
        created!.plan.id,
        testVaultId,
        newPremises,
      );
      expect(error).toBeNull();
      expect(result!.premises.costOfLivingChangePoints).toEqual(
        newPremises.costOfLivingChangePoints,
      );
      expect(result!.premises.salaryChangePoints).toEqual(
        defaultPremises.salaryChangePoints,
      );
    });

    it('should reject negative change point amount', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const [error] = await service.updatePremises(
        created!.plan.id,
        testVaultId,
        { salaryChangePoints: [{ month: 0, amount: -100 }] },
      );
      expect(error).not.toBeNull();
    });

    it('should reject empty salary change points', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const [error] = await service.updatePremises(
        created!.plan.id,
        testVaultId,
        { salaryChangePoints: [] },
      );
      expect(error).not.toBeNull();
    });

    it('should reject empty cost of living change points', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const [error] = await service.updatePremises(
        created!.plan.id,
        testVaultId,
        { costOfLivingChangePoints: [] },
      );
      expect(error).not.toBeNull();
    });

    it('should reject when no fields are provided', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const [error] = await service.updatePremises(
        created!.plan.id,
        testVaultId,
        {},
      );
      expect(error).not.toBeNull();
    });

    it('should reject plan not found', async () => {
      const [error] = await service.updatePremises(
        'nonexistent',
        testVaultId,
        { salaryChangePoints: [{ month: 0, amount: 5000 }] },
      );
      expect(error).not.toBeNull();
    });

    it('should reject wrong vault', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const [error] = await service.updatePremises(
        created!.plan.id,
        'other-vault',
        { salaryChangePoints: [{ month: 0, amount: 5000 }] },
      );
      expect(error).not.toBeNull();
    });
  });

  describe('addAllocation', () => {
    it('should add an allocation to a plan', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const [error, allocation] = await service.addAllocation(
        created!.plan.id,
        testVaultId,
        {
          label: 'Viagem',
          target: 6000,
          monthlyAmount: [{ month: 0, amount: 500 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        },
      );
      expect(error).toBeNull();
      expect(allocation!.label).toBe('Viagem');
      expect(allocation!.target).toBe(6000);
      expect(allocation!.planId).toBe(created!.plan.id);
    });

    it('should reject empty label', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const [error] = await service.addAllocation(
        created!.plan.id,
        testVaultId,
        {
          label: '',
          target: 6000,
          monthlyAmount: [{ month: 0, amount: 500 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        },
      );
      expect(error).not.toBeNull();
    });

    it('should reject negative target', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const [error] = await service.addAllocation(
        created!.plan.id,
        testVaultId,
        {
          label: 'Viagem',
          target: -1,
          monthlyAmount: [{ month: 0, amount: 500 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        },
      );
      expect(error).not.toBeNull();
    });

    it('should reject plan not found', async () => {
      const [error] = await service.addAllocation(
        'nonexistent',
        testVaultId,
        {
          label: 'Viagem',
          target: 6000,
          monthlyAmount: [{ month: 0, amount: 500 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        },
      );
      expect(error).not.toBeNull();
    });

    it('should reject wrong vault', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
      });
      const [error] = await service.addAllocation(
        created!.plan.id,
        'other-vault',
        {
          label: 'Viagem',
          target: 6000,
          monthlyAmount: [{ month: 0, amount: 500 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        },
      );
      expect(error).not.toBeNull();
    });
  });

  describe('updateAllocation', () => {
    it('should update allocation label and target', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        allocations: [{
          label: 'Reserva',
          target: 50000,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        }],
      });
      const allocationId = created!.allocations[0].id;
      const [error, updated] = await service.updateAllocation(
        allocationId,
        testVaultId,
        { label: 'Reserva de Emergência', target: 60000 },
      );
      expect(error).toBeNull();
      expect(updated!.label).toBe('Reserva de Emergência');
      expect(updated!.target).toBe(60000);
    });

    it('should update monthlyAmount', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        allocations: [{
          label: 'Reserva',
          target: 50000,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        }],
      });
      const allocationId = created!.allocations[0].id;
      const [error, updated] = await service.updateAllocation(
        allocationId,
        testVaultId,
        { monthlyAmount: [{ month: 0, amount: 1500 }] },
      );
      expect(error).toBeNull();
      expect(updated!.monthlyAmount).toEqual([{ month: 0, amount: 1500 }]);
    });

    it('should reject negative target', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        allocations: [{
          label: 'Reserva',
          target: 50000,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        }],
      });
      const allocationId = created!.allocations[0].id;
      const [error] = await service.updateAllocation(
        allocationId,
        testVaultId,
        { target: -1 },
      );
      expect(error).not.toBeNull();
    });

    it('should reject allocation not found', async () => {
      const [error] = await service.updateAllocation(
        'nonexistent',
        testVaultId,
        { label: 'New' },
      );
      expect(error).not.toBeNull();
    });

    it('should reject wrong vault', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        allocations: [{
          label: 'Reserva',
          target: 50000,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        }],
      });
      const allocationId = created!.allocations[0].id;
      const [error] = await service.updateAllocation(
        allocationId,
        'other-vault',
        { label: 'New' },
      );
      expect(error).not.toBeNull();
    });
  });

  describe('removeAllocation', () => {
    it('should remove an allocation', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        allocations: [{
          label: 'Reserva',
          target: 50000,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        }],
      });
      const allocationId = created!.allocations[0].id;
      const [error] = await service.removeAllocation(allocationId, testVaultId);
      expect(error).toBeNull();
      const allocations = await allocationRepository.findByPlanId(created!.plan.id);
      expect(allocations).toHaveLength(0);
    });

    it('should reject allocation not found', async () => {
      const [error] = await service.removeAllocation('nonexistent', testVaultId);
      expect(error).not.toBeNull();
    });

    it('should reject wrong vault', async () => {
      const [, created] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        allocations: [{
          label: 'Reserva',
          target: 50000,
          monthlyAmount: [{ month: 0, amount: 1000 }],
          realizationMode: 'manual',
          scheduledMovements: [],
        }],
      });
      const allocationId = created!.allocations[0].id;
      const [error] = await service.removeAllocation(allocationId, 'other-vault');
      expect(error).not.toBeNull();
    });
  });

  describe('bindAllocationToEstrato', () => {
    async function createPlanWithAllocation(
      realizationMode: 'immediate' | 'manual' | 'onCompletion',
    ) {
      const [, result] = await service.create({
        vaultId: testVaultId,
        name: 'Test Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        allocations: [
          {
            label: 'Test Allocation',
            target: 10000,
            monthlyAmount: [{ month: 0, amount: 500 }],
            realizationMode,
            scheduledMovements: [],
          },
        ],
      });
      return result!;
    }

    it('should bind Reserva allocation to saving box — success, estratoId updated', async () => {
      const { allocations } = await createPlanWithAllocation('manual');
      const allocation = allocations[0];

      const [error, updated] = await service.bindAllocationToEstrato(
        allocation.id,
        'box-1',
        testVaultId,
      );

      expect(error).toBeNull();
      expect(updated!.estratoId).toBe('box-1');
    });

    it('should return error when binding Pagamento allocation', async () => {
      const { allocations } = await createPlanWithAllocation('immediate');
      const allocation = allocations[0];

      const [error] = await service.bindAllocationToEstrato(
        allocation.id,
        'box-1',
        testVaultId,
      );

      expect(error).toBe('Só alocações Reserva podem vincular a estrato');
    });

    it('should unbind (estratoId: null) — success, estratoId cleared', async () => {
      const { allocations } = await createPlanWithAllocation('manual');
      const allocation = allocations[0];

      // First bind
      await service.bindAllocationToEstrato(
        allocation.id,
        'box-1',
        testVaultId,
      );

      // Then unbind
      const [error, updated] = await service.bindAllocationToEstrato(
        allocation.id,
        null,
        testVaultId,
      );

      expect(error).toBeNull();
      expect(updated!.estratoId).toBeNull();
    });

    it('should return error when allocation not found', async () => {
      const [error] = await service.bindAllocationToEstrato(
        'nonexistent-allocation',
        'box-1',
        testVaultId,
      );

      expect(error).toBe('Alocação não encontrada');
    });

    it('should return error when box not found', async () => {
      vi.mocked(vaultQueryService.findBoxById).mockResolvedValueOnce(null);

      const { allocations } = await createPlanWithAllocation('manual');
      const allocation = allocations[0];

      const [error] = await service.bindAllocationToEstrato(
        allocation.id,
        'nonexistent-box',
        testVaultId,
      );

      expect(error).toBe('Estrato não encontrado');
    });

    it('should return error when box type is spending', async () => {
      vi.mocked(vaultQueryService.findBoxById).mockResolvedValueOnce({
        id: 'box-2',
        name: 'Gastos',
        type: 'spending',
        balance: 0,
        goalAmount: 0,
        vaultId: testVaultId,
      });

      const { allocations } = await createPlanWithAllocation('manual');
      const allocation = allocations[0];

      const [error] = await service.bindAllocationToEstrato(
        allocation.id,
        'box-2',
        testVaultId,
      );

      expect(error).toBe('Só estratos do tipo saving podem ser vinculados');
    });
  });
});
