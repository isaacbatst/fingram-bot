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
};

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
      purchaseDate: null,
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
  /** Fatura de cartão a que pertence — ver `isInvoiceRemainder`/`isInvoicePurchase`. */
  public invoiceId: string | null = null;
  /**
   * Data em que a compra foi feita, quando ligada a uma fatura. Nesse caso
   * `date` é a data de pagamento da fatura, que é quando a compra conta.
   */
  public purchaseDate: Date | null = null;

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
  }

  /** O que a fatura ainda não detalhou. Calculado pela fatura, não editável. */
  get isInvoiceRemainder(): boolean {
    return this.invoiceId !== null && this.purchaseDate === null;
  }

  /** Compra do extrato do cartão ligada a uma fatura. */
  get isInvoicePurchase(): boolean {
    return this.invoiceId !== null && this.purchaseDate !== null;
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
      invoiceRole: this.isInvoiceRemainder
        ? 'remainder'
        : this.isInvoicePurchase
          ? 'purchase'
          : null,
      purchaseDate: this.purchaseDate,
    };
  }
}
