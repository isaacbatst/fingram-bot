import crypto from 'crypto';
import { Either, left, right } from './either';
import { TransactionDTO } from '../dto/transaction.dto,';
import { Category } from './category';

type ConstructorParams = {
  id: string;
  code: string;
  vaultId: string;
  boxId: string;
  transferId: string | null;
  amount: number;
  isCommitted: boolean;
  description?: string;
  createdAt: Date;
  categoryId: string | null;
  type: 'expense' | 'income';
  date: Date;
  allocationId: string | null;
  withdrawalType: 'withdrawal' | 'realization' | null;
  invoiceId?: string | null;
  purchaseDate?: Date | null;
  invoiceRole?: InvoiceRole | null;
  sourceTransactionId?: string | null;
  paymentId?: string | null;
};

/**
 * Papel de uma transação no cartão de crédito:
 * - `purchase`: compra (ou estorno) de uma fatura. Não conta sozinha em nada.
 * - `part`: a parte de uma compra paga por um pagamento. Conta na data dele.
 * - `remainder`: o que um pagamento pagou além das compras conhecidas.
 * `part` e `remainder` são derivados: o `Vault` os recalcula.
 */
export type InvoiceRole = 'purchase' | 'part' | 'remainder';

type CreateParams = {
  amount: number;
  vaultId: string;
  boxId?: string;
  transferId?: string | null;
  description?: string;
  type?: 'expense' | 'income';
  date: Date;
  categoryId?: string | null;
  createdAt?: Date;
  allocationId?: string;
  withdrawalType?: 'withdrawal' | 'realization' | null;
  invoiceId?: string | null;
  invoiceRole?: InvoiceRole | null;
  purchaseDate?: Date | null;
  sourceTransactionId?: string | null;
  paymentId?: string | null;
};

export class Transaction {
  static create(params: CreateParams): Transaction {
    const id = crypto.randomUUID();
    const code = crypto.randomBytes(2).toString('hex');
    return new Transaction({
      id,
      code,
      vaultId: params.vaultId,
      boxId: params.boxId ?? '',
      transferId: params.transferId ?? null,
      amount: params.amount,
      isCommitted: false,
      description: params.description,
      createdAt: params.createdAt ?? new Date(),
      categoryId: params.categoryId ?? null,
      type: params.type ?? 'expense',
      date: params.date,
      allocationId: params.allocationId ?? null,
      withdrawalType: params.withdrawalType ?? null,
      invoiceId: params.invoiceId ?? null,
      purchaseDate: params.purchaseDate ?? null,
      invoiceRole: params.invoiceRole ?? null,
      sourceTransactionId: params.sourceTransactionId ?? null,
      paymentId: params.paymentId ?? null,
    });
  }

  static restore(params: ConstructorParams): Transaction {
    return new Transaction({
      ...params,
    });
  }
  readonly id: string;
  readonly code: string;
  public readonly vaultId: string;
  public boxId: string;
  public transferId: string | null = null;
  public amount: number;
  public isCommitted: boolean = false;
  public description?: string;
  public createdAt: Date = new Date();
  public categoryId: string | null = null;
  public type: 'expense' | 'income' = 'expense';
  public date: Date = new Date();
  public allocationId: string | null = null;
  public withdrawalType: 'withdrawal' | 'realization' | null = null;
  /** Fatura (ciclo do cartão) a que pertence — ver `invoiceRole`. */
  public invoiceId: string | null = null;
  public invoiceRole: InvoiceRole | null = null;
  /** Numa parte (`part`): a data em que a compra foi feita. */
  public purchaseDate: Date | null = null;
  /** Numa parte: a compra de que ela é parte. */
  public sourceTransactionId: string | null = null;
  /** Numa parte ou não discriminado: o pagamento que a fez contar. */
  public paymentId: string | null = null;

  private constructor(params: ConstructorParams) {
    this.id = params.id;
    this.code = params.code;
    this.vaultId = params.vaultId;
    this.boxId = params.boxId;
    this.transferId = params.transferId;
    this.amount = params.amount;
    this.isCommitted = params.isCommitted;
    this.description = params.description;
    this.createdAt = params.createdAt;
    this.categoryId = params.categoryId;
    this.type = params.type;
    this.date = params.date;
    this.allocationId = params.allocationId;
    this.withdrawalType = params.withdrawalType;
    this.invoiceId = params.invoiceId ?? null;
    this.purchaseDate = params.purchaseDate ?? null;
    this.invoiceRole = params.invoiceRole ?? null;
    this.sourceTransactionId = params.sourceTransactionId ?? null;
    this.paymentId = params.paymentId ?? null;
  }

  /** Compra de cartão: só conta pelas partes que os pagamentos pagam. */
  get isCardPurchase(): boolean {
    return this.invoiceRole === 'purchase';
  }

  /** Não discriminado de um pagamento. Calculado, não editável. */
  get isInvoiceRemainder(): boolean {
    return this.invoiceRole === 'remainder';
  }

  /** Parte de uma compra paga por um pagamento. Calculada, não editável. */
  get isInvoicePart(): boolean {
    return this.invoiceRole === 'part';
  }

  /** Linha derivada (parte ou não discriminado), mantida pelo `Vault`. */
  get isInvoiceDerived(): boolean {
    return this.isInvoicePart || this.isInvoiceRemainder;
  }

  /**
   * Entra em saldo, orçamento e totais. A compra de cartão fica de fora: quem
   * conta são as partes dela, na data do pagamento que a paga.
   */
  get countsInLedger(): boolean {
    return !this.isCardPurchase;
  }
  commit(): Either<string, boolean> {
    if (this.isCommitted) {
      return left(`Transação #${this.code} já efetivada`);
    }
    this.isCommitted = true;
    return right(true);
  }

  toDTO(category: Category | null): TransactionDTO {
    return {
      id: this.id,
      code: this.code,
      amount: this.amount,
      isCommitted: this.isCommitted,
      description: this.description,
      type: this.type,
      createdAt: this.createdAt,
      vaultId: this.vaultId,
      boxId: this.boxId,
      transferId: this.transferId,
      transferToBoxId: null,
      category,
      date: this.date,
      allocationId: this.allocationId,
      invoiceId: this.invoiceId,
      invoiceRole: this.invoiceRole,
      purchaseDate: this.purchaseDate,
      purchaseId: this.sourceTransactionId,
      paymentId: this.paymentId,
    };
  }
}
