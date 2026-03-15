export interface TransactionDTO {
  id: string;
  code: string;
  description?: string;
  amount: number;
  isCommitted: boolean;
  createdAt: Date;
  type: 'expense' | 'income';
  vaultId: string;
  boxId: string;
  transferId: string | null;
  transferToBoxId: string | null;
  date: Date;
  category: {
    id: string;
    name: string;
    code: string;
    description?: string;
  } | null;
  allocationId?: string | null;
}
