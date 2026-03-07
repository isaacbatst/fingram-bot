import * as crypto from 'crypto';

export type PlanStatus = 'draft' | 'active' | 'archived';

export interface Premises {
  salary: number;
  monthlyInvestment?: number;
}

export interface FundRule {
  fundId: string;
  label: string;
  target: number;
  priority: number;
}

export interface Phase {
  id: string;
  name: string;
  startMonth: number;
  endMonth: number;
  monthlyCost: number;
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

export interface MonthData {
  month: number;
  date: Date;
  phase: string;
  income: number;
  expenses: number;
  surplus: number;
  funds: Record<string, number>;
}

type ConstructorParams = {
  id: string;
  vaultId: string;
  name: string;
  status: PlanStatus;
  startDate: Date;
  premises: Premises;
  fundAllocation: FundRule[];
  phases: Phase[];
  milestones: Milestone[];
  createdAt: Date;
};

type CreateParams = {
  vaultId: string;
  name: string;
  startDate: Date;
  premises: Premises;
  fundAllocation: FundRule[];
  phases: Phase[];
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
      fundAllocation: params.fundAllocation,
      phases: params.phases,
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
  public fundAllocation: FundRule[];
  public phases: Phase[];
  public milestones: Milestone[];
  readonly createdAt: Date;

  private constructor(params: ConstructorParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.name = params.name;
    this.status = params.status;
    this.startDate = params.startDate;
    this.premises = params.premises;
    this.fundAllocation = params.fundAllocation;
    this.phases = params.phases;
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
      fundAllocation: this.fundAllocation,
      phases: this.phases,
      milestones: this.milestones,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
