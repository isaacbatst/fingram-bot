import * as crypto from 'crypto';

export type PlanStatus = 'draft' | 'active' | 'archived';

export interface Premises {
  salary: number;
  monthlyCost: number;
  monthlyInvestment?: number;
}

export interface FundRule {
  fundId: string;
  label: string;
  target: number;
  priority: number;
}

export interface MonthData {
  month: number;
  date: Date;
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
  createdAt: Date;
};

type CreateParams = {
  vaultId: string;
  name: string;
  startDate: Date;
  premises: Premises;
  fundAllocation: FundRule[];
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
  readonly createdAt: Date;

  private constructor(params: ConstructorParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.name = params.name;
    this.status = params.status;
    this.startDate = params.startDate;
    this.premises = params.premises;
    this.fundAllocation = params.fundAllocation;
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
      createdAt: this.createdAt.toISOString(),
    };
  }
}
