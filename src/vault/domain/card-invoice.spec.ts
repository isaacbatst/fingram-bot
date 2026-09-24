import { describe, expect, it } from 'vitest';
import {
  computeInvoiceBreakdown,
  statementMatchesInvoice,
} from './card-invoice';

const expense = (amount: number) => ({ type: 'expense' as const, amount });
const income = (amount: number) => ({ type: 'income' as const, amount });

describe('computeInvoiceBreakdown', () => {
  it('should leave the whole amount undetailed while nothing is linked', () => {
    expect(computeInvoiceBreakdown(3200, [])).toEqual({
      itemized: 0,
      remainder: 3200,
      excess: 0,
      purchaseCount: 0,
      status: 'awaiting',
    });
  });

  it('should shrink the remainder by the linked purchases', () => {
    const breakdown = computeInvoiceBreakdown(3200, [
      expense(1000),
      expense(1050),
    ]);
    expect(breakdown.itemized).toBe(2050);
    expect(breakdown.remainder).toBe(1150);
    expect(breakdown.status).toBe('partial');
  });

  it('should be detailed when the purchases add up to what was paid', () => {
    const breakdown = computeInvoiceBreakdown(3200, [
      expense(2000),
      expense(1200),
    ]);
    expect(breakdown.remainder).toBe(0);
    expect(breakdown.excess).toBe(0);
    expect(breakdown.status).toBe('detailed');
  });

  it('should surface purchases beyond the paid amount instead of going negative', () => {
    const breakdown = computeInvoiceBreakdown(3200, [expense(3500)]);
    expect(breakdown.remainder).toBe(0);
    expect(breakdown.excess).toBe(300);
    expect(breakdown.status).toBe('exceeded');
  });

  it('should subtract a refund on the card from what was itemized', () => {
    const breakdown = computeInvoiceBreakdown(900, [
      expense(1000),
      income(100),
    ]);
    expect(breakdown.itemized).toBe(900);
    expect(breakdown.status).toBe('detailed');
  });

  it('should not leave a floating point residue as remainder', () => {
    // 0.1 + 0.2 !== 0.3 em ponto flutuante.
    const breakdown = computeInvoiceBreakdown(0.3, [
      expense(0.1),
      expense(0.2),
    ]);
    expect(breakdown.remainder).toBe(0);
    expect(breakdown.status).toBe('detailed');
  });
});

describe('statementMatchesInvoice', () => {
  const invoice = {
    amount: 3200,
    paymentDate: new Date(Date.UTC(2026, 8, 10)),
  };
  const statement = {
    ledgerBalance: -3200,
    netTotal: 1500,
    firstDate: new Date(Date.UTC(2026, 7, 3)),
    lastDate: new Date(Date.UTC(2026, 8, 2)),
  };

  it('should match by the statement balance, whatever its sign', () => {
    expect(statementMatchesInvoice(invoice, statement)).toBe(true);
  });

  it('should match by the net total of the purchases', () => {
    expect(
      statementMatchesInvoice(invoice, {
        ...statement,
        ledgerBalance: null,
        netTotal: 3200,
      }),
    ).toBe(true);
  });

  it('should not match a different amount', () => {
    expect(
      statementMatchesInvoice(invoice, {
        ...statement,
        ledgerBalance: -3199.99,
        netTotal: 1500,
      }),
    ).toBe(false);
  });

  it('should not match a payment made before the statement period', () => {
    expect(
      statementMatchesInvoice(
        { ...invoice, paymentDate: new Date(Date.UTC(2026, 6, 10)) },
        statement,
      ),
    ).toBe(false);
  });

  it('should not match a payment made long after the statement closed', () => {
    expect(
      statementMatchesInvoice(
        { ...invoice, paymentDate: new Date(Date.UTC(2026, 10, 30)) },
        statement,
      ),
    ).toBe(false);
  });

  it('should match on amount alone when the statement has no dates', () => {
    expect(
      statementMatchesInvoice(invoice, {
        ...statement,
        firstDate: null,
        lastDate: null,
      }),
    ).toBe(true);
  });
});
