import crypto from 'crypto';

export type ImportBatchStatus = 'reviewing' | 'done';
export type ImportAccountKind = 'bank' | 'creditcard';

type CreateParams = {
  vaultId: string;
  accountKey: string;
  accountLabel?: string | null;
  boxId: string | null;
  kind?: ImportAccountKind;
  currency?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  ledgerBalance?: number | null;
  fileName?: string | null;
  /** Lines skipped at ingestion because their FITID was already seen on this account. */
  duplicateCount?: number;
  /** Optional cutoff chosen at upload. Null means the whole file was taken. */
  fromDate?: Date | null;
  /** Lines dropped for falling before `fromDate`. */
  outOfRangeCount?: number;
  /** Fatura (ciclo do cartão) que este extrato de cartão detalha. */
  invoiceId?: string | null;
  /** Extrato de cartão marcado como "sem fatura": sai da lista de pendentes. */
  noInvoice?: boolean;
  createdAt?: Date;
};

type RestoreParams = CreateParams & {
  id: string;
  status: ImportBatchStatus;
  duplicateCount: number;
  outOfRangeCount: number;
  createdAt: Date;
};

/** One imported statement file, and the account it came from. */
export class ImportBatch {
  static create(params: CreateParams): ImportBatch {
    return new ImportBatch({
      ...params,
      id: crypto.randomUUID(),
      status: 'reviewing',
      duplicateCount: params.duplicateCount ?? 0,
      outOfRangeCount: params.outOfRangeCount ?? 0,
      createdAt: params.createdAt ?? new Date(),
    });
  }

  static restore(params: RestoreParams): ImportBatch {
    return new ImportBatch(params);
  }

  readonly id: string;
  readonly vaultId: string;
  readonly accountKey: string;
  readonly kind: ImportAccountKind;
  readonly currency: string | null;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly ledgerBalance: number | null;
  readonly fileName: string | null;
  readonly fromDate: Date | null;
  readonly createdAt: Date;

  accountLabel: string | null;
  boxId: string | null;
  status: ImportBatchStatus;
  duplicateCount: number;
  outOfRangeCount: number;
  invoiceId: string | null;
  noInvoice: boolean;

  private constructor(params: RestoreParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.accountKey = params.accountKey;
    this.accountLabel = params.accountLabel ?? null;
    this.boxId = params.boxId;
    this.kind = params.kind ?? 'bank';
    this.currency = params.currency ?? null;
    this.periodStart = params.periodStart ?? null;
    this.periodEnd = params.periodEnd ?? null;
    this.ledgerBalance = params.ledgerBalance ?? null;
    this.fileName = params.fileName ?? null;
    this.fromDate = params.fromDate ?? null;
    this.status = params.status;
    this.duplicateCount = params.duplicateCount;
    this.outOfRangeCount = params.outOfRangeCount;
    this.invoiceId = params.invoiceId ?? null;
    this.noInvoice = params.noInvoice ?? false;
    this.createdAt = params.createdAt;
  }

  markDone(): void {
    this.status = 'done';
  }
}
