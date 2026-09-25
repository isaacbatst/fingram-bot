import crypto from 'crypto';

export type CardInvoiceStatus =
  /** Nenhuma compra ligada ainda: o valor inteiro está como não discriminado. */
  | 'awaiting'
  /** Parte das compras ligada; o resto segue não discriminado. */
  | 'partial'
  /** As compras ligadas somam exatamente o valor pago. */
  | 'detailed'
  /** As compras ligadas somam mais que o valor pago. */
  | 'exceeded';

export type InvoiceBreakdown = {
  /** Compras ligadas menos estornos ligados. */
  itemized: number;
  /** O que falta detalhar: vira a transação "não discriminado". */
  remainder: number;
  /** Quanto as compras ligadas passam do valor pago. Nunca é escondido. */
  excess: number;
  purchaseCount: number;
  status: CardInvoiceStatus;
};

type CreateParams = {
  vaultId: string;
  boxId: string;
  amount: number;
  paymentDate: Date;
  cardLabel?: string | null;
  createdAt?: Date;
};

type RestoreParams = CreateParams & {
  id: string;
  cardLabel: string | null;
  createdAt: Date;
};

const toCents = (value: number) => Math.round(value * 100);

/**
 * Quanto de uma fatura já foi detalhado pelas compras do extrato do cartão.
 *
 * Um estorno (crédito no cartão) abate da fatura, então entra subtraindo. As
 * contas são feitas em centavos: somar dezenas de valores em ponto flutuante
 * deixaria um "resto" de R$ 0,0000001 que manteria viva uma transação fantasma.
 */
export function computeInvoiceBreakdown(
  amount: number,
  linked: { type: 'income' | 'expense'; amount: number }[],
): InvoiceBreakdown {
  const itemizedCents = linked.reduce(
    (sum, t) =>
      sum + (t.type === 'expense' ? toCents(t.amount) : -toCents(t.amount)),
    0,
  );
  const amountCents = toCents(amount);
  const remainderCents = Math.max(0, amountCents - itemizedCents);
  const excessCents = Math.max(0, itemizedCents - amountCents);

  let status: CardInvoiceStatus;
  if (linked.length === 0) status = 'awaiting';
  else if (remainderCents > 0) status = 'partial';
  else if (excessCents > 0) status = 'exceeded';
  else status = 'detailed';

  return {
    itemized: itemizedCents / 100,
    remainder: remainderCents / 100,
    excess: excessCents / 100,
    purchaseCount: linked.length,
    status,
  };
}

/** Até quantos dias depois do fechamento do extrato um pagamento ainda é dele. */
const PAYMENT_WINDOW_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Diz se um extrato de cartão parece ser o detalhe de uma fatura paga.
 *
 * O valor precisa bater ao centavo com o saldo declarado no arquivo
 * (`LEDGERBAL`, que no cartão é o total da fatura) ou com a soma líquida das
 * compras do arquivo. A data do pagamento precisa cair entre o início do
 * extrato e algumas semanas depois do fim — a fatura é paga depois de fechar.
 *
 * É só para sugerir o vínculo automático; o usuário pode trocar ou desfazer.
 */
export function statementMatchesInvoice(
  invoice: { amount: number; paymentDate: Date },
  statement: {
    ledgerBalance: number | null;
    netTotal: number;
    firstDate: Date | null;
    lastDate: Date | null;
  },
): boolean {
  const target = toCents(invoice.amount);
  const byBalance =
    statement.ledgerBalance !== null &&
    Math.abs(toCents(statement.ledgerBalance)) === target;
  const byTotal = toCents(statement.netTotal) === target;
  if (!byBalance && !byTotal) return false;

  if (!statement.firstDate || !statement.lastDate) return true;
  const paid = invoice.paymentDate.getTime();
  return (
    paid >= statement.firstDate.getTime() &&
    paid <= statement.lastDate.getTime() + PAYMENT_WINDOW_DAYS * DAY_MS
  );
}

/**
 * Uma fatura de cartão paga.
 *
 * Nasce do débito na conta corrente e conta como gasto desde já, na data do
 * pagamento. As compras do extrato do cartão, quando ligadas a ela, passam a
 * contar nessa mesma data e abatem o que ainda está "não discriminado" — assim
 * o mês do pagamento soma sempre o que foi pago, nem mais nem menos.
 */
export class CardInvoice {
  static create(params: CreateParams): CardInvoice {
    return new CardInvoice({
      ...params,
      id: crypto.randomUUID(),
      cardLabel: params.cardLabel ?? null,
      createdAt: params.createdAt ?? new Date(),
    });
  }

  static restore(params: RestoreParams): CardInvoice {
    return new CardInvoice(params);
  }

  readonly id: string;
  readonly vaultId: string;
  readonly boxId: string;
  readonly amount: number;
  readonly paymentDate: Date;
  readonly createdAt: Date;
  cardLabel: string | null;

  private constructor(params: RestoreParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.boxId = params.boxId;
    this.amount = params.amount;
    this.paymentDate = params.paymentDate;
    this.cardLabel = params.cardLabel;
    this.createdAt = params.createdAt;
  }
}

export const INVOICE_REMAINDER_DESCRIPTION =
  'Fatura do cartão · não discriminado';
