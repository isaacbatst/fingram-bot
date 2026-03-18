import * as crypto from 'crypto';
import { ChangePoint } from '@/plan/domain/change-point';
import { Either, left, right } from '@/vault/domain/either';

export type AllocationType = 'reserva' | 'pagamento';

export type RealizationMode = 'immediate' | 'manual' | 'onCompletion' | 'never';

export interface AllocationFinancing {
  principal: number;
  annualRate: number;
  termMonths: number;
  system: 'sac' | 'price';
  constructionMonths?: number;
  gracePeriodMonths?: number;
  releasePercent?: number;
  startMonth?: number;
}

export interface AllocationScheduledMovement {
  month: number;
  amount: number;
  label: string;
  type: 'in' | 'out';
  destinationBoxId?: string;
  additionalToMonthly?: boolean;
}

type CreateParams = {
  planId: string;
  label: string;
  target: number;
  monthlyAmount: ChangePoint[];
  realizationMode: RealizationMode;
  yieldRate?: number;
  financing?: AllocationFinancing;
  scheduledMovements: AllocationScheduledMovement[];
  initialBalance?: number;
};

type RestoreParams = {
  id: string;
  planId: string;
  label: string;
  target: number;
  monthlyAmount: ChangePoint[];
  realizationMode: RealizationMode;
  yieldRate?: number;
  financing?: AllocationFinancing;
  scheduledMovements: AllocationScheduledMovement[];
  initialBalance?: number;
  estratoId: string | null;
  createdAt: Date;
};

export class Allocation {
  static create(params: CreateParams): Allocation {
    return new Allocation({
      id: crypto.randomUUID(),
      ...params,
      estratoId: null,
      createdAt: new Date(),
    });
  }

  static restore(params: RestoreParams): Allocation {
    return new Allocation(params);
  }

  readonly id: string;
  readonly planId: string;
  label: string;
  target: number;
  monthlyAmount: ChangePoint[];
  readonly realizationMode: RealizationMode;
  yieldRate?: number;
  financing?: AllocationFinancing;
  scheduledMovements: AllocationScheduledMovement[];
  initialBalance?: number;
  estratoId: string | null;
  readonly createdAt: Date;

  private constructor(params: RestoreParams) {
    this.id = params.id;
    this.planId = params.planId;
    this.label = params.label;
    this.target = params.target;
    this.monthlyAmount = params.monthlyAmount;
    this.realizationMode = params.realizationMode;
    this.yieldRate = params.yieldRate;
    this.financing = params.financing;
    this.scheduledMovements = params.scheduledMovements;
    this.initialBalance = params.initialBalance;
    this.estratoId = params.estratoId;
    this.createdAt = params.createdAt;
  }

  get type(): AllocationType {
    return this.realizationMode === 'immediate' ? 'pagamento' : 'reserva';
  }

  bindToEstrato(estratoId: string): Either<string, void> {
    if (this.realizationMode === 'immediate') {
      return left('Só alocações Reserva podem vincular a estrato');
    }
    this.estratoId = estratoId;
    return right(undefined);
  }

  unbindEstrato(): void {
    this.estratoId = null;
  }
}
