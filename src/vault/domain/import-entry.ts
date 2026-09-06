import crypto from 'crypto';
import { Either, left, right } from './either';

export type ImportEntryStatus = 'pending' | 'confirmed' | 'dismissed';
export type SuggestionSource = 'history' | 'ai' | 'none';

/**
 * Reduces a bank description to the establishment behind it.
 *
 * Banks append a terminal or store number to each purchase, so the same place
 * arrives as "PAG*IFOOD 1234" one day and "PAG*IFOOD 5678" the next. Without
 * dropping that suffix the review would show one group per purchase, which defeats
 * the point of grouping.
 *
 * Deliberately conservative: only a single trailing numeric token is removed, and
 * only when something meaningful is left. Merging two different establishments is a
 * worse failure than leaving two groups for the same one.
 */
/**
 * Reconhece a quitação de fatura de cartão, que aparece dos dois lados.
 *
 * No extrato do cartão ela vem como crédito ("Pagamento recebido"); na conta
 * corrente, como débito ("PAGAMENTO FATURA"). Nenhum dos dois é gasto novo — são
 * o mesmo evento, e as compras já foram contadas. Lançar qualquer um deles
 * duplicaria: o débito infla a despesa, o crédito infla a receita.
 *
 * `kind` importa: "pagamento recebido" numa conta corrente pode ser alguém te
 * pagando, o que é receita de verdade. Só num cartão isso é quitação.
 */
export function isSettlementDescription(
  value: string,
  kind: 'bank' | 'creditcard',
): boolean {
  const text = normalizeDescription(value);
  if (/FATURA/.test(text)) return true;
  if (/PAG(?:AMENTO|TO)?\s*(?:DE\s+)?CART[AÃ]O/.test(text)) return true;
  if (kind === 'creditcard' && /PAGAMENTO\s+RECEBIDO/.test(text)) return true;
  return false;
}

export function normalizeDescription(value: string): string {
  const collapsed = value.trim().toUpperCase().replace(/\s+/g, ' ');
  const withoutTrailingNumber = collapsed.replace(/\s+[\d.\-/]+$/, '');
  return withoutTrailingNumber.length >= 3 ? withoutTrailingNumber : collapsed;
}

/** Values copied from the file. Never overwritten — see `docs/product/spec-operational.md` §9. */
type RawParams = {
  fitId: string;
  rawDate: Date;
  rawAmount: number;
  rawType: 'income' | 'expense';
  rawMemo: string | null;
  rawName: string | null;
};

type CreateParams = RawParams & {
  vaultId: string;
  batchId: string;
  accountKey: string;
  boxId: string | null;
  categoryId?: string | null;
  suggestedCategoryId?: string | null;
  suggestionSource?: SuggestionSource;
  createdAt?: Date;
};

type RestoreParams = CreateParams & {
  id: string;
  date: Date;
  amount: number;
  type: 'income' | 'expense';
  description: string;
  status: ImportEntryStatus;
  transactionId: string | null;
  createdAt: Date;
};

export type ImportEntryEdit = {
  date?: Date;
  amount?: number;
  type?: 'income' | 'expense';
  description?: string;
  categoryId?: string | null;
  boxId?: string | null;
};

/**
 * A single line of an imported statement, awaiting the user's decision.
 *
 * An entry is not a transaction: it only becomes one when confirmed. Keeping the
 * decision here — instead of as a flag on `transaction` — is what lets a dismissed
 * line be remembered without polluting the transaction table. See the design
 * decisions in `docs/product/spec-operational.md`.
 */
export class ImportEntry {
  static create(params: CreateParams): ImportEntry {
    return new ImportEntry({
      ...params,
      id: crypto.randomUUID(),
      // The working values start as a faithful copy of the file's own values.
      date: params.rawDate,
      amount: Math.abs(params.rawAmount),
      type: params.rawType,
      description: params.rawMemo ?? params.rawName ?? '',
      categoryId: params.categoryId ?? null,
      suggestedCategoryId: params.suggestedCategoryId ?? null,
      suggestionSource: params.suggestionSource ?? 'none',
      status: 'pending',
      transactionId: null,
      createdAt: params.createdAt ?? new Date(),
    });
  }

  static restore(params: RestoreParams): ImportEntry {
    return new ImportEntry(params);
  }

  readonly id: string;
  readonly vaultId: string;
  readonly batchId: string;
  readonly accountKey: string;
  readonly fitId: string;
  readonly rawDate: Date;
  readonly rawAmount: number;
  readonly rawType: 'income' | 'expense';
  readonly rawMemo: string | null;
  readonly rawName: string | null;
  readonly createdAt: Date;

  date: Date;
  amount: number;
  type: 'income' | 'expense';
  description: string;
  categoryId: string | null;
  boxId: string | null;
  suggestedCategoryId: string | null;
  suggestionSource: SuggestionSource;
  status: ImportEntryStatus;
  transactionId: string | null;

  private constructor(params: RestoreParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.batchId = params.batchId;
    this.accountKey = params.accountKey;
    this.fitId = params.fitId;
    this.rawDate = params.rawDate;
    this.rawAmount = params.rawAmount;
    this.rawType = params.rawType;
    this.rawMemo = params.rawMemo;
    this.rawName = params.rawName;
    this.date = params.date;
    this.amount = params.amount;
    this.type = params.type;
    this.description = params.description;
    this.categoryId = params.categoryId ?? null;
    this.boxId = params.boxId;
    this.suggestedCategoryId = params.suggestedCategoryId ?? null;
    this.suggestionSource = params.suggestionSource ?? 'none';
    this.status = params.status;
    this.transactionId = params.transactionId;
    this.createdAt = params.createdAt;
  }

  /**
   * The key that groups lines from the same establishment, and — from ISA-116 on —
   * matches a description against previously confirmed ones. Derived from the raw
   * values so that editing the description never changes it.
   */
  get matchKey(): string {
    return normalizeDescription(this.rawName ?? this.rawMemo ?? '');
  }

  edit(changes: ImportEntryEdit): Either<string, boolean> {
    if (this.status !== 'pending') {
      return left(`Lançamento já ${this.statusLabel()} não pode ser editado`);
    }
    if (changes.amount !== undefined && !(changes.amount > 0)) {
      return left('O valor deve ser maior que zero');
    }

    if (changes.date !== undefined) this.date = changes.date;
    if (changes.amount !== undefined) this.amount = changes.amount;
    if (changes.type !== undefined) this.type = changes.type;
    if (changes.description !== undefined) {
      this.description = changes.description;
    }
    if (changes.categoryId !== undefined) this.categoryId = changes.categoryId;
    if (changes.boxId !== undefined) this.boxId = changes.boxId;
    return right(true);
  }

  confirm(transactionId: string): Either<string, boolean> {
    if (this.status !== 'pending') {
      return left(`Lançamento já ${this.statusLabel()}`);
    }
    this.status = 'confirmed';
    this.transactionId = transactionId;
    return right(true);
  }

  dismiss(): Either<string, boolean> {
    if (this.status !== 'pending') {
      return left(`Lançamento já ${this.statusLabel()}`);
    }
    this.status = 'dismissed';
    return right(true);
  }

  /**
   * Called when the transaction created from this entry is deleted later.
   * The entry stays `confirmed` on purpose: deleting is a deliberate decision, and
   * a re-import must not resurrect the line.
   */
  detachTransaction(): void {
    this.transactionId = null;
  }

  private statusLabel(): string {
    return this.status === 'confirmed' ? 'confirmado' : 'ignorado';
  }
}
