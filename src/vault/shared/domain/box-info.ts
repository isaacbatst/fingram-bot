import { BoxType } from '@/vault/domain/box';

export interface BoxInfo {
  id: string;
  name: string;
  type: BoxType;
  balance: number;
  goalAmount: number | null;
  vaultId: string;
}
