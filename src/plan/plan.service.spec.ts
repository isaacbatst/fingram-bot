import { describe, it, expect, beforeEach } from 'vitest';
import { PlanService } from './plan.service';
import { PlanInMemoryRepository } from './repositories/in-memory/plan-in-memory.repository';
import { FundRule, Phase, Premises } from './domain/plan';

describe('PlanService', () => {
  let service: PlanService;
  let repository: PlanInMemoryRepository;

  const defaultPremises: Premises = {
    salary: 10000,
  };

  const defaultFundAllocation: FundRule[] = [
    { fundId: 'emergency', label: 'Emergencia', target: 10000, priority: 1 },
    { fundId: 'car', label: 'Carro', target: 20000, priority: 2 },
  ];

  const defaultPhases: Phase[] = [
    { id: 'general', name: 'Geral', startMonth: 0, endMonth: 119, monthlyCost: 6000 },
  ];

  beforeEach(() => {
    repository = new PlanInMemoryRepository();
    service = new PlanService(repository);
  });

  describe('create', () => {
    it('should create a plan in draft status', async () => {
      const [error, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: defaultFundAllocation,
      });

      expect(error).toBeNull();
      expect(plan!.name).toBe('My Plan');
      expect(plan!.status).toBe('draft');
      expect(plan!.vaultId).toBe('vault-1');
      expect(plan!.premises).toEqual(defaultPremises);
      expect(plan!.fundAllocation).toEqual(defaultFundAllocation);
    });

    it('should persist the plan in the repository', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: defaultFundAllocation,
      });

      const found = await repository.findById(plan!.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(plan!.id);
    });

    it('should reject empty name', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: '  ',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: defaultFundAllocation,
      });

      expect(error).toBe('Nome do plano e obrigatorio');
    });

    it('should reject negative salary', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: { salary: -1000 },
        phases: defaultPhases,
        fundAllocation: [],
      });

      expect(error).toBe('Salario nao pode ser negativo');
    });

    it('should reject plan with no phases', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: [],
        fundAllocation: [],
      });

      expect(error).toBe('Plano deve ter pelo menos uma fase');
    });

    it('should reject phase with negative cost', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: [{ id: 'p', name: 'P', startMonth: 0, endMonth: 11, monthlyCost: -100 }],
        fundAllocation: [],
      });

      expect(error).toBe('Custo mensal da fase nao pode ser negativo');
    });

    it('should reject phase with startMonth > endMonth', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: [{ id: 'p', name: 'P', startMonth: 10, endMonth: 5, monthlyCost: 1000 }],
        fundAllocation: [],
      });

      expect(error).toBe('Mes inicial da fase deve ser menor ou igual ao mes final');
    });

    it('should reject negative monthly investment', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: { salary: 10000, monthlyInvestment: -100 },
        phases: defaultPhases,
        fundAllocation: [],
      });

      expect(error).toBe('Investimento mensal nao pode ser negativo');
    });
  });

  describe('getById', () => {
    it('should return plan by id when vault matches', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: defaultFundAllocation,
      });

      const [error, found] = await service.getById(plan!.id, 'vault-1');
      expect(error).toBeNull();
      expect(found!.id).toBe(plan!.id);
    });

    it('should return error when plan not found', async () => {
      const [error] = await service.getById('nonexistent', 'vault-1');
      expect(error).toBe('Plano nao encontrado');
    });

    it('should return error when vault does not match', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: defaultFundAllocation,
      });

      const [error] = await service.getById(plan!.id, 'vault-2');
      expect(error).toBe('Plano nao encontrado');
    });
  });

  describe('getProjection', () => {
    it('should return projection for a plan', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: defaultFundAllocation,
      });

      const [error, projection] = await service.getProjection(
        plan!.id,
        'vault-1',
        12,
      );

      expect(error).toBeNull();
      expect(projection).toHaveLength(12);
      expect(projection![0].income).toBe(10000);
      expect(projection![0].expenses).toBe(6000);
      expect(projection![0].surplus).toBe(4000);
    });

    it('should return error when plan not found', async () => {
      const [error] = await service.getProjection('nonexistent', 'vault-1');
      expect(error).toBe('Plano nao encontrado');
    });

    it('should return error when vault does not match', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: defaultFundAllocation,
      });

      const [error] = await service.getProjection(plan!.id, 'vault-2');
      expect(error).toBe('Plano nao encontrado');
    });

    it('should default to 120 months', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: defaultFundAllocation,
      });

      const [, projection] = await service.getProjection(plan!.id, 'vault-1');

      expect(projection).toHaveLength(120);
    });
  });

  describe('delete', () => {
    it('should delete a plan when vault matches', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: defaultFundAllocation,
      });

      const [error] = await service.delete(plan!.id, 'vault-1');
      expect(error).toBeNull();

      const found = await repository.findById(plan!.id);
      expect(found).toBeNull();
    });

    it('should return error when plan not found', async () => {
      const [error] = await service.delete('nonexistent', 'vault-1');
      expect(error).toBe('Plano nao encontrado');
    });

    it('should return error when vault does not match', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: defaultFundAllocation,
      });

      const [error] = await service.delete(plan!.id, 'vault-2');
      expect(error).toBe('Plano nao encontrado');

      // Plan should still exist
      const found = await repository.findById(plan!.id);
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
        phases: defaultPhases,
        fundAllocation: [],
      });

      await service.create({
        vaultId: 'vault-1',
        name: 'Plan B',
        startDate: new Date('2026-02-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: [],
      });

      await service.create({
        vaultId: 'vault-2',
        name: 'Plan C',
        startDate: new Date('2026-03-01'),
        premises: defaultPremises,
        phases: defaultPhases,
        fundAllocation: [],
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
});
