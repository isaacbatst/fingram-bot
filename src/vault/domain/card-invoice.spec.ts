import { describe, expect, it } from 'vitest';
import {
  allocateCard,
  AllocationPayment,
  AllocationPurchase,
  computeInvoiceFigures,
} from './card-invoice';

const day = (month: number, date: number) =>
  new Date(Date.UTC(2026, month - 1, date));

const AUG_CLOSING = day(9, 2);
const SEP_CLOSING = day(10, 2);

const purchase = (
  id: string,
  amount: number,
  date: Date,
  extra: Partial<AllocationPurchase> = {},
): AllocationPurchase => ({
  id,
  type: 'expense',
  amount,
  date,
  createdAt: date,
  invoiceClosingDate: AUG_CLOSING,
  ...extra,
});

const payment = (
  id: string,
  amount: number,
  date: Date,
): AllocationPayment => ({
  id,
  amount,
  date,
  createdAt: date,
});

describe('allocateCard', () => {
  it('divide uma compra entre dois pagamentos, na ordem da data da compra (exemplo da spec)', () => {
    const result = allocateCard({
      purchases: [
        purchase('c3', 2000, day(8, 20)),
        purchase('c1', 700, day(8, 5)),
        purchase('c2', 500, day(8, 12)),
      ],
      payments: [
        payment('p2', 2200, day(9, 10)),
        payment('p1', 1000, day(8, 15)),
      ],
    });

    expect(result.parts).toEqual([
      { paymentId: 'p1', purchaseId: 'c1', cents: 70000 },
      { paymentId: 'p1', purchaseId: 'c2', cents: 30000 },
      { paymentId: 'p2', purchaseId: 'c2', cents: 20000 },
      { paymentId: 'p2', purchaseId: 'c3', cents: 200000 },
    ]);
    expect(result.remainders).toEqual([]);
    expect(result.uncovered.size).toBe(0);
  });

  it('deixa a pagar o que nenhum pagamento cobriu', () => {
    const result = allocateCard({
      purchases: [
        purchase('c1', 700, day(8, 5)),
        purchase('c2', 500, day(8, 12)),
      ],
      payments: [payment('p1', 1000, day(8, 15))],
    });
    expect(result.uncovered.get('c2')).toBe(20000);
    expect(result.uncovered.has('c1')).toBe(false);
  });

  it('o que o pagamento paga além das compras vira não discriminado', () => {
    const result = allocateCard({
      purchases: [purchase('c1', 700, day(8, 5))],
      payments: [payment('p1', 1000, day(9, 10))],
    });
    expect(result.remainders).toEqual([{ paymentId: 'p1', cents: 30000 }]);
  });

  it('sem compras, o pagamento inteiro é não discriminado', () => {
    const result = allocateCard({
      purchases: [],
      payments: [payment('p1', 3200, day(9, 10))],
    });
    expect(result.parts).toEqual([]);
    expect(result.remainders).toEqual([{ paymentId: 'p1', cents: 320000 }]);
  });

  it('partes + não discriminado de cada pagamento somam o valor dele', () => {
    const payments = [
      payment('p1', 333.33, day(8, 15)),
      payment('p2', 1000.01, day(9, 10)),
      payment('p3', 50, day(10, 10)),
    ];
    const result = allocateCard({
      purchases: [
        purchase('c1', 100.1, day(8, 1)),
        purchase('c2', 0.2, day(8, 2)),
        purchase('c3', 999.99, day(8, 30)),
        purchase('c4', 12.34, day(9, 5), { invoiceClosingDate: SEP_CLOSING }),
      ],
      payments,
    });
    for (const p of payments) {
      const parts = result.parts
        .filter((x) => x.paymentId === p.id)
        .reduce((s, x) => s + x.cents, 0);
      const rest = result.remainders
        .filter((x) => x.paymentId === p.id)
        .reduce((s, x) => s + x.cents, 0);
      expect(parts + rest).toBe(Math.round(p.amount * 100));
    }
  });

  it('a fila respeita a fatura antes da data: compra da fatura seguinte espera a anterior', () => {
    const result = allocateCard({
      purchases: [
        // Feita antes do fechamento, mas o extrato a pôs na fatura seguinte.
        purchase('late', 100, day(9, 1), { invoiceClosingDate: SEP_CLOSING }),
        purchase('early', 100, day(9, 2)),
      ],
      payments: [payment('p1', 100, day(9, 10))],
    });
    expect(result.parts).toEqual([
      { paymentId: 'p1', purchaseId: 'early', cents: 10000 },
    ]);
  });

  it('rotativo: o que a fatura não pagou é coberto pelo pagamento seguinte antes das compras novas', () => {
    const result = allocateCard({
      purchases: [
        purchase('ago', 1000, day(8, 10)),
        purchase('set', 400, day(9, 10), { invoiceClosingDate: SEP_CLOSING }),
        purchase('juros', 30, day(9, 20), { invoiceClosingDate: SEP_CLOSING }),
      ],
      payments: [payment('p1', 600, day(9, 9)), payment('p2', 830, day(10, 9))],
    });
    expect(result.parts).toEqual([
      { paymentId: 'p1', purchaseId: 'ago', cents: 60000 },
      { paymentId: 'p2', purchaseId: 'ago', cents: 40000 },
      { paymentId: 'p2', purchaseId: 'set', cents: 40000 },
      { paymentId: 'p2', purchaseId: 'juros', cents: 3000 },
    ]);
  });

  it('estorno abate a compra mais antiga antes dos pagamentos e não gera gasto', () => {
    const result = allocateCard({
      purchases: [
        purchase('c1', 700, day(8, 5)),
        purchase('c2', 500, day(8, 12)),
        purchase('estorno', 200, day(8, 25), { type: 'income' }),
      ],
      payments: [payment('p1', 1000, day(9, 10))],
    });
    expect(result.parts).toEqual([
      { paymentId: 'p1', purchaseId: 'c1', cents: 50000 },
      { paymentId: 'p1', purchaseId: 'c2', cents: 50000 },
    ]);
    expect(result.remainders).toEqual([]);
    expect(result.uncovered.size).toBe(0);
  });

  it('pagamento a mais cobre as compras seguintes (crédito no cartão)', () => {
    const result = allocateCard({
      purchases: [
        purchase('ago', 800, day(8, 10)),
        purchase('set', 600, day(9, 10), { invoiceClosingDate: SEP_CLOSING }),
      ],
      payments: [payment('p1', 1000, day(9, 9)), payment('p2', 400, day(10, 9))],
    });
    expect(result.parts).toEqual([
      { paymentId: 'p1', purchaseId: 'ago', cents: 80000 },
      { paymentId: 'p1', purchaseId: 'set', cents: 20000 },
      { paymentId: 'p2', purchaseId: 'set', cents: 40000 },
    ]);
    expect(result.remainders).toEqual([]);
  });
});

describe('computeInvoiceFigures', () => {
  const invoice = (
    id: string,
    closingDate: Date,
    dueDate: Date,
    extra: { isOpen?: boolean; purchasesCents?: number; paidCents?: number } = {},
  ) => ({
    id,
    closingDate,
    dueDate,
    isOpen: extra.isOpen ?? false,
    purchasesCents: extra.purchasesCents ?? 0,
    paidCents: extra.paidCents ?? 0,
  });

  it('status por fatura: aberta, fechada, parcial, paga, paga a mais', () => {
    const today = day(9, 5);
    const figures = computeInvoiceFigures(
      [
        invoice('open', day(10, 2), day(10, 9), { isOpen: true }),
        invoice('closed', day(9, 2), day(9, 9), { purchasesCents: 1000 }),
      ],
      today,
    );
    expect(figures.get('open')!.status).toBe('open');
    expect(figures.get('closed')!.status).toBe('closed');

    const single = (paidCents: number) =>
      computeInvoiceFigures(
        [
          invoice('x', day(9, 2), day(9, 9), {
            purchasesCents: 1000,
            paidCents,
          }),
        ],
        today,
      ).get('x')!;
    expect(single(500).status).toBe('partial');
    expect(single(500).remaining).toBe(5);
    expect(single(1000).status).toBe('paid');
    expect(single(1500).status).toBe('overpaid');
    expect(single(1500).overpaid).toBe(5);
  });

  it('fatura vencida sem pagamento total vai para a próxima como saldo transferido', () => {
    const figures = computeInvoiceFigures(
      [
        invoice('ago', day(9, 2), day(9, 9), {
          purchasesCents: 100000,
          paidCents: 60000,
        }),
        invoice('set', day(10, 2), day(10, 9), { purchasesCents: 43000 }),
      ],
      day(9, 20),
    );
    expect(figures.get('ago')).toMatchObject({
      status: 'overdue',
      remaining: 400,
      carriedOut: 400,
    });
    expect(figures.get('set')).toMatchObject({
      carriedIn: 400,
      purchasesTotal: 430,
      total: 830,
    });
  });

  it('antes do vencimento não há saldo transferido', () => {
    const figures = computeInvoiceFigures(
      [
        invoice('ago', day(9, 2), day(9, 9), { purchasesCents: 100000 }),
        invoice('set', day(10, 2), day(10, 9), { isOpen: true }),
      ],
      day(9, 5),
    );
    expect(figures.get('ago')!.carriedOut).toBe(0);
    expect(figures.get('set')!.carriedIn).toBe(0);
  });
});
