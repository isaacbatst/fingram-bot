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
  /** Fatura (ciclo do cartão) a que a transação pertence. */
  invoiceId?: string | null;
  /**
   * `purchase`: compra de cartão (não conta sozinha; não aparece nas listas).
   * `part`: parte de uma compra paga por um pagamento, na data dele.
   * `remainder`: não discriminado de um pagamento.
   */
  invoiceRole?: 'purchase' | 'part' | 'remainder' | null;
  /** Numa parte: data em que a compra foi feita. */
  purchaseDate?: Date | null;
  /** Numa parte: id da compra. */
  purchaseId?: string | null;
  /** Numa parte: valor total da compra (a parte pode ser só um pedaço dela). */
  purchaseAmount?: number | null;
  /** Numa parte ou não discriminado: id do pagamento de fatura. */
  paymentId?: string | null;
}
