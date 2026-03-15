import * as crypto from 'crypto';
import { ChangePoint } from './change-point';

export type PlanStatus = 'draft' | 'active' | 'archived';

export interface Premises {
  salaryChangePoints: ChangePoint[];
  costOfLivingChangePoints: ChangePoint[];
}

export type FinancingPhase =
  | 'construction'
  | 'grace'
  | 'amortization'
  | 'paid_off';

export interface FinancingMonthDetail {
  payment: number;
  amortization: number;
  interest: number;
  outstandingBalance: number;
  phase: FinancingPhase;
}

export type MilestoneType =
  | 'start'
  | 'fund_complete'
  | 'action'
  | 'decision'
  | 'celebration';

export interface Milestone {
  month: number;
  label: string;
  type: MilestoneType;
}

export interface RealMonthData {
  month: number;
  realIncome: number;
  realCostOfLiving: number;
  allocationPayments: { allocationId: string; amount: number }[];
}

export interface MonthData {
  month: number;
  date: Date;
  income: number;
  costOfLiving: number;
  surplus: number;
  cash: number;
  allocations: Record<string, number>;
  allocationPayments: Record<string, number>;
  allocationYields: Record<string, number>;
  totalYield: number;
  scheduledMovements: {
    allocationId: string;
    amount: number;
    label: string;
    type: 'in' | 'out';
    destinationBoxId?: string;
  }[];
  totalWealth: number;
  totalCommitted: number;
  financingDetails: Record<string, FinancingMonthDetail>;
  isReal: boolean;
}

type ConstructorParams = {
  id: string;
  vaultId: string;
  name: string;
  status: PlanStatus;
  startDate: Date;
  premises: Premises;
  milestones: Milestone[];
  createdAt: Date;
};

type CreateParams = {
  vaultId: string;
  name: string;
  startDate: Date;
  premises: Premises;
  milestones?: Milestone[];
};

export class Plan {
  static create(params: CreateParams): Plan {
    return new Plan({
      id: crypto.randomUUID(),
      vaultId: params.vaultId,
      name: params.name,
      status: 'draft',
      startDate: params.startDate,
      premises: params.premises,
      milestones: params.milestones ?? [],
      createdAt: new Date(),
    });
  }

  static restore(params: ConstructorParams): Plan {
    return new Plan(params);
  }

  readonly id: string;
  readonly vaultId: string;
  public name: string;
  public status: PlanStatus;
  public startDate: Date;
  public premises: Premises;
  public milestones: Milestone[];
  readonly createdAt: Date;

  private constructor(params: ConstructorParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.name = params.name;
    this.status = params.status;
    this.startDate = params.startDate;
    this.premises = params.premises;
    this.milestones = params.milestones;
    this.createdAt = params.createdAt;
  }

  toJSON() {
    return {
      id: this.id,
      vaultId: this.vaultId,
      name: this.name,
      status: this.status,
      startDate: this.startDate.toISOString(),
      premises: this.premises,
      milestones: this.milestones,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
