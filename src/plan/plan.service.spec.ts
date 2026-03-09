import { describe, it, expect, beforeEach } from 'vitest';
import { PlanService } from './plan.service';
import { PlanInMemoryRepository } from './repositories/in-memory/plan-in-memory.repository';
import { Box, Premises } from './domain/plan';

describe('PlanService', () => {
  let service: PlanService;
  let repository: PlanInMemoryRepository;

  const defaultPremises: Premises = {
    salaryChangePoints: [{ month: 0, amount: 10000 }],
    costOfLivingChangePoints: [{ month: 0, amount: 6000 }],
  };

  const defaultBoxes: Box[] = [
    {
      id: 'emergency',
      label: 'Emergencia',
      target: 10000,
      monthlyAmount: [{ month: 0, amount: 2000 }],
      holdsFunds: true,
      scheduledPayments: [],
    },
    {
      id: 'car',
      label: 'Carro',
      target: 20000,
      monthlyAmount: [{ month: 0, amount: 1000 }],
      holdsFunds: false,
      scheduledPayments: [],
    },
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
        boxes: defaultBoxes,
      });

      expect(error).toBeNull();
      expect(plan!.name).toBe('My Plan');
      expect(plan!.status).toBe('draft');
      expect(plan!.vaultId).toBe('vault-1');
      expect(plan!.premises).toEqual(defaultPremises);
      expect(plan!.boxes).toHaveLength(2);
    });

    it('should persist the plan in the repository', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        boxes: defaultBoxes,
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
        boxes: defaultBoxes,
      });

      expect(error).toBe('Nome do plano e obrigatorio');
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
        boxes: defaultBoxes,
      });

      expect(error).toBe(
        'Premissas devem ter pelo menos um change point de salario',
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
        boxes: defaultBoxes,
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
        boxes: defaultBoxes,
      });

      expect(error).toBe(
        'Valor do change point de salario nao pode ser negativo',
      );
    });

    it('should reject box with empty label', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        boxes: [
          {
            id: 'b1',
            label: '  ',
            target: 1000,
            monthlyAmount: [{ month: 0, amount: 100 }],
            holdsFunds: true,
            scheduledPayments: [],
          },
        ],
      });

      expect(error).toBe('Label da box e obrigatoria');
    });

    it('should reject box with negative target', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        boxes: [
          {
            id: 'b1',
            label: 'Box',
            target: -100,
            monthlyAmount: [{ month: 0, amount: 100 }],
            holdsFunds: true,
            scheduledPayments: [],
          },
        ],
      });

      expect(error).toBe('Target da box nao pode ser negativo');
    });

    it('should reject scheduled payment with zero amount', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        boxes: [
          {
            id: 'b1',
            label: 'Box',
            target: 1000,
            monthlyAmount: [{ month: 0, amount: 100 }],
            holdsFunds: true,
            scheduledPayments: [{ month: 6, amount: 0, label: 'Bonus' }],
          },
        ],
      });

      expect(error).toBe(
        'Valor do pagamento agendado deve ser maior que zero',
      );
    });

    it('should reject scheduled payment with empty label', async () => {
      const [error] = await service.create({
        vaultId: 'vault-1',
        name: 'Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        boxes: [
          {
            id: 'b1',
            label: 'Box',
            target: 1000,
            monthlyAmount: [{ month: 0, amount: 100 }],
            holdsFunds: true,
            scheduledPayments: [{ month: 6, amount: 500, label: '' }],
          },
        ],
      });

      expect(error).toBe('Label do pagamento agendado e obrigatoria');
    });

    it('should create plan with empty boxes', async () => {
      const [error, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'Minimal Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        boxes: [],
      });

      expect(error).toBeNull();
      expect(plan!.boxes).toHaveLength(0);
    });
  });

  describe('getById', () => {
    it('should return plan by id when vault matches', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        boxes: defaultBoxes,
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
        boxes: defaultBoxes,
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
        boxes: defaultBoxes,
      });

      const [error, projection] = await service.getProjection(
        plan!.id,
        'vault-1',
        12,
      );

      expect(error).toBeNull();
      expect(projection).toHaveLength(12);
      expect(projection![0].income).toBe(10000);
      expect(projection![0].costOfLiving).toBe(6000);
      expect(projection![0].surplus).toBe(1000);
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
        boxes: defaultBoxes,
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
        boxes: defaultBoxes,
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
        boxes: defaultBoxes,
      });

      const [error] = await service.delete(plan!.id, 'vault-1');
      expect(error).toBeNull();

      const found = await repository.findById(plan!.id);
      expect(found).toBeNull();
    });

    it('should return error when vault does not match', async () => {
      const [, plan] = await service.create({
        vaultId: 'vault-1',
        name: 'My Plan',
        startDate: new Date('2026-01-01'),
        premises: defaultPremises,
        boxes: defaultBoxes,
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
        boxes: [],
      });

      await service.create({
        vaultId: 'vault-1',
        name: 'Plan B',
        startDate: new Date('2026-02-01'),
        premises: defaultPremises,
        boxes: [],
      });

      await service.create({
        vaultId: 'vault-2',
        name: 'Plan C',
        startDate: new Date('2026-03-01'),
        premises: defaultPremises,
        boxes: [],
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
