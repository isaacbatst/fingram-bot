import * as crypto from 'crypto';
import { ChangePoint } from './change-point';

export type PlanStatus = 'draft' | 'active' | 'archived';

export interface Premises {
  salaryChangePoints: ChangePoint[];
  costOfLivingChangePoints: ChangePoint[];
}

export interface BoxScheduledPayment {
  month: number;
  amount: number;
  label: string;
  additionalToMonthly?: boolean;
}

export interface Box {
  id: string;
  label: string;
  target: number;
  monthlyAmount: ChangePoint[];
  holdsFunds: boolean;
  scheduledPayments: BoxScheduledPayment[];
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
  income: number;
  costOfLiving: number;
  surplus: number;
  cash: number;
  boxes: Record<string, number>;
  boxPayments: Record<string, number>;
  scheduledPayments: { boxId: string; amount: number; label: string }[];
  totalWealth: number;
  totalCommitted: number;
}

type ConstructorParams = {
  id: string;
  vaultId: string;
  name: string;
  status: PlanStatus;
  startDate: Date;
  premises: Premises;
  boxes: Box[];
  milestones: Milestone[];
  createdAt: Date;
};

type CreateParams = {
  vaultId: string;
  name: string;
  startDate: Date;
  premises: Premises;
  boxes: Box[];
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
      boxes: params.boxes.map((b) => ({
        ...b,
        id: b.id || crypto.randomUUID(),
      })),
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
  public boxes: Box[];
  public milestones: Milestone[];
  readonly createdAt: Date;

  private constructor(params: ConstructorParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.name = params.name;
    this.status = params.status;
    this.startDate = params.startDate;
    this.premises = params.premises;
    this.boxes = params.boxes;
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
      boxes: this.boxes,
      milestones: this.milestones,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
