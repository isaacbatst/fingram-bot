import crypto from 'crypto';

const DAY_MS = 24 * 60 * 60 * 1000;

type InvoiceParams = {
  id: string;
  vaultId: string;
  cardId: string;
  periodStart: Date;
  closingDate: Date;
  dueDate: Date;
  closed: boolean;
  createdAt: Date;
};

/**
 * Fatura = ciclo de um cartão: período de compras, fechamento e vencimento.
 * Não guarda valor: o total sai das compras ligadas, o pago dos pagamentos.
 * Ver `docs/product/spec-operational.md` §9.
 */
export class CardInvoice {
  static create(
    params: Omit<InvoiceParams, 'id' | 'closed' | 'createdAt'> & {
      closed?: boolean;
      createdAt?: Date;
    },
  ): CardInvoice {
    return new CardInvoice({
      ...params,
      id: crypto.randomUUID(),
      closed: params.closed ?? false,
      createdAt: params.createdAt ?? new Date(),
    });
  }

  static restore(params: InvoiceParams): CardInvoice {
    return new CardInvoice(params);
  }

  readonly id: string;
  readonly vaultId: string;
  readonly cardId: string;
  readonly createdAt: Date;
  periodStart: Date;
  closingDate: Date;
  dueDate: Date;
  /** Fechada por um extrato importado ou à mão, antes da data de fechamento. */
  closed: boolean;

  private constructor(params: InvoiceParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.cardId = params.cardId;
    this.periodStart = params.periodStart;
    this.closingDate = params.closingDate;
    this.dueDate = params.dueDate;
    this.closed = params.closed;
    this.createdAt = params.createdAt;
  }

  /** O período é fechado nas duas pontas, em dias UTC. */
  contains(date: Date): boolean {
    const t = date.getTime();
    return (
      t >= this.periodStart.getTime() && t < this.closingDate.getTime() + DAY_MS
    );
  }

  /** `today` é a meia-noite UTC do dia. */
  isOpen(today: Date): boolean {
    return !this.closed && today.getTime() <= this.closingDate.getTime();
  }
}

type PaymentParams = {
  id: string;
  vaultId: string;
  invoiceId: string;
  boxId: string;
  amount: number;
  date: Date;
  imported: boolean;
  importEntryId: string | null;
  createdAt: Date;
};

/**
 * Um pagamento de fatura: o débito na conta corrente (ou um pagamento
 * antecipado). Nunca é gasto por si: o valor dele vira as partes das compras
 * que ele cobre e, o que sobra, "não discriminado" — tudo na data dele.
 */
export class CardPayment {
  static create(
    params: Omit<
      PaymentParams,
      'id' | 'imported' | 'importEntryId' | 'createdAt'
    > & {
      imported?: boolean;
      importEntryId?: string | null;
      createdAt?: Date;
    },
  ): CardPayment {
    return new CardPayment({
      ...params,
      id: crypto.randomUUID(),
      imported: params.imported ?? false,
      importEntryId: params.importEntryId ?? null,
      createdAt: params.createdAt ?? new Date(),
    });
  }

  static restore(params: PaymentParams): CardPayment {
    return new CardPayment(params);
  }

  readonly id: string;
  readonly vaultId: string;
  readonly createdAt: Date;
  invoiceId: string;
  /** Estrato de onde o dinheiro saiu. */
  boxId: string;
  amount: number;
  date: Date;
  /** O débito veio de um extrato importado (e não só informado à mão). */
  imported: boolean;
  importEntryId: string | null;

  private constructor(params: PaymentParams) {
    this.id = params.id;
    this.vaultId = params.vaultId;
    this.invoiceId = params.invoiceId;
    this.boxId = params.boxId;
    this.amount = params.amount;
    this.date = params.date;
    this.imported = params.imported;
    this.importEntryId = params.importEntryId;
    this.createdAt = params.createdAt;
  }
}

export const toCents = (value: number) => Math.round(value * 100);

export type AllocationPurchase = {
  id: string;
  /** `income` é estorno (crédito no cartão): abate compras, não é receita. */
  type: 'income' | 'expense';
  amount: number;
  date: Date;
  createdAt: Date;
  /** Fechamento da fatura da compra: ordena compras entre faturas. */
  invoiceClosingDate: Date;
};

export type AllocationPayment = {
  id: string;
  amount: number;
  date: Date;
  createdAt: Date;
};

export type CardAllocation = {
  /** Parte de uma compra paga por um pagamento. Conta na data do pagamento. */
  parts: { paymentId: string; purchaseId: string; cents: number }[];
  /** O que um pagamento pagou além das compras conhecidas: não discriminado. */
  remainders: { paymentId: string; cents: number }[];
  /** O que falta pagar de cada compra ("a pagar"), em centavos. */
  uncovered: Map<string, number>;
};

function compareKeys(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

const purchaseKey = (p: AllocationPurchase) => [
  p.invoiceClosingDate.getTime(),
  p.date.getTime(),
  p.createdAt.getTime(),
  p.id,
];

/**
 * Distribui os pagamentos de um cartão pelas compras dele.
 *
 * As compras formam uma fila na ordem da fatura e, dentro dela, da data da
 * compra. Os pagamentos cobrem a fila em ordem de data, e uma compra pode ser
 * dividida entre dois pagamentos. Estornos cobrem a fila antes dos pagamentos,
 * sem gerar gasto: abatem a compra mais antiga. O que um pagamento paga além
 * da fila vira não discriminado, na data dele.
 *
 * A fila é do cartão inteiro, não de cada fatura: o que uma fatura não pagou
 * (rotativo) é coberto pelo próximo pagamento antes das compras novas, e o que
 * um pagamento pagou a mais cobre as próximas compras. Assim partes + não
 * discriminado de um pagamento somam sempre o valor dele — o mês de cada
 * pagamento soma exatamente o que foi pago.
 *
 * Tudo em centavos inteiros, para o resto nunca virar R$ 0,0000001.
 */
export function allocateCard(input: {
  purchases: AllocationPurchase[];
  payments: AllocationPayment[];
}): CardAllocation {
  const queue = input.purchases
    .filter((p) => p.type === 'expense' && toCents(p.amount) > 0)
    .sort((a, b) => compareKeys(purchaseKey(a), purchaseKey(b)))
    .map((p) => ({ id: p.id, left: toCents(p.amount) }));
  const credits = input.purchases
    .filter((p) => p.type === 'income' && toCents(p.amount) > 0)
    .sort((a, b) => compareKeys(purchaseKey(a), purchaseKey(b)));
  const payments = input.payments
    .filter((p) => toCents(p.amount) > 0)
    .sort((a, b) =>
      compareKeys(
        [a.date.getTime(), a.createdAt.getTime(), a.id],
        [b.date.getTime(), b.createdAt.getTime(), b.id],
      ),
    );

  let cursor = 0;
  const consume = (
    cents: number,
    onPart: (purchaseId: string, taken: number) => void,
  ): number => {
    let left = cents;
    while (left > 0 && cursor < queue.length) {
      const item = queue[cursor];
      const taken = Math.min(item.left, left);
      item.left -= taken;
      left -= taken;
      onPart(item.id, taken);
      if (item.left === 0) cursor++;
    }
    return left;
  };

  for (const credit of credits) consume(toCents(credit.amount), () => {});

  const parts: CardAllocation['parts'] = [];
  const remainders: CardAllocation['remainders'] = [];
  for (const payment of payments) {
    const left = consume(toCents(payment.amount), (purchaseId, cents) =>
      parts.push({ paymentId: payment.id, purchaseId, cents }),
    );
    if (left > 0) remainders.push({ paymentId: payment.id, cents: left });
  }

  const uncovered = new Map<string, number>();
  for (const item of queue) {
    if (item.left > 0) uncovered.set(item.id, item.left);
  }
  return { parts, remainders, uncovered };
}

export type InvoiceStatus =
  /** Antes do fechamento: ainda recebe compras. */
  | 'open'
  /** Fechada, nada pago ainda, antes do vencimento. */
  | 'closed'
  /** Fechada, pago menos que o total, antes do vencimento. */
  | 'partial'
  | 'paid'
  | 'overpaid'
  /** Vencida sem pagamento total: o que falta vai para a próxima (rotativo). */
  | 'overdue';

export type InvoiceFigures = {
  /** Compras − estornos da fatura (juros e IOF do extrato são compras). */
  purchasesTotal: number;
  /** Saldo transferido da fatura anterior vencida; negativo é crédito. */
  carriedIn: number;
  /** Valor da fatura: compras + saldo transferido. */
  total: number;
  paid: number;
  remaining: number;
  overpaid: number;
  /** O que foi para a próxima fatura depois do vencimento. */
  carriedOut: number;
  status: InvoiceStatus;
};

/**
 * Números de cada fatura de um cartão, na ordem dos fechamentos.
 *
 * O saldo de uma fatura vencida (a pagar ou pago a mais) passa para a próxima
 * como "saldo transferido". É apresentação: quem decide o que conta no
 * orçamento é `allocateCard`, que já cobre a fila do cartão inteiro.
 */
export function computeInvoiceFigures(
  invoices: {
    id: string;
    closingDate: Date;
    dueDate: Date;
    isOpen: boolean;
    purchasesCents: number;
    paidCents: number;
  }[],
  today: Date,
): Map<string, InvoiceFigures> {
  const sorted = [...invoices].sort(
    (a, b) => a.closingDate.getTime() - b.closingDate.getTime(),
  );
  const result = new Map<string, InvoiceFigures>();
  let carry = 0;
  sorted.forEach((invoice, index) => {
    const hasNext = index < sorted.length - 1;
    const totalCents = invoice.purchasesCents + carry;
    const diff = totalCents - invoice.paidCents;
    const pastDue = today.getTime() > invoice.dueDate.getTime();
    const carriedOut = pastDue && hasNext ? diff : 0;

    let status: InvoiceStatus;
    if (invoice.isOpen) status = 'open';
    else if (diff === 0) status = 'paid';
    else if (diff < 0) status = 'overpaid';
    else if (pastDue) status = 'overdue';
    else if (invoice.paidCents > 0) status = 'partial';
    else status = 'closed';

    result.set(invoice.id, {
      purchasesTotal: invoice.purchasesCents / 100,
      carriedIn: carry / 100,
      total: totalCents / 100,
      paid: invoice.paidCents / 100,
      remaining: Math.max(0, diff) / 100,
      overpaid: Math.max(0, -diff) / 100,
      carriedOut: carriedOut / 100,
      status,
    });
    carry = carriedOut;
  });
  return result;
}

export const invoiceRemainderDescription = (cardName: string) =>
  `Fatura ${cardName} · não discriminado`;
