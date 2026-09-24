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
  /** Fatura de cartão a que a transação pertence. */
  invoiceId?: string | null;
  /** `remainder`: o não discriminado da fatura. `purchase`: compra ligada a ela. */
  invoiceRole?: 'remainder' | 'purchase' | null;
  /** Data da compra, quando ela conta na data de pagamento da fatura. */
  purchaseDate?: Date | null;
}
