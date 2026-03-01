import crypto from 'crypto';

type ConstructorParams = {
  id: string;
  vaultId: string;
  name: string;
  goalAmount: number | null;
  isDefault: boolean;
  createdAt: Date;
};

type CreateParams = {
  vaultId: string;
  name: string;
  goalAmount?: number | null;
  isDefault?: boolean;
};

export class Box {
  static create(params: CreateParams): Box {
    return new Box({
      id: crypto.randomUUID(),
      vaultId: params.vaultId,
      name: params.name,
      goalAmount: params.goalAmount ?? null,
      isDefault: params.isDefault ?? false,
      createdAt: new Date(),
    });
  }

  static restore(params: ConstructorParams): Box {
    return new Box(params);
  }

  readonly id: string;
  readonly vaultId: string;
  public name: string;
  public goalAmount: number | null;
  public readonly isDefault: boolean;
  public readonly createdAt: Date;

  private constructor(params: ConstructorParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.name = params.name;
    this.goalAmount = params.goalAmount;
    this.isDefault = params.isDefault;
    this.createdAt = params.createdAt;
  }
}
