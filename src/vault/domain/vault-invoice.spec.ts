import { beforeEach, describe, expect, it } from 'vitest';
import { Vault } from './vault';
import { Transaction } from './transaction';
import { Category } from './category';
import { Box } from './box';

const day = (month: number, date: number) =>
  new Date(Date.UTC(2026, month - 1, date));

const AUGUST = { month: 8, year: 2026 };
const SEPTEMBER = { month: 9, year: 2026 };

describe('Vault — fatura de cartão', () => {
  let vault: Vault;
  let conta: Box;
  let cartao: Box;
  const mercado = new Category('c-mercado', 'Compras', '2');

  beforeEach(() => {
    vault = new Vault();
    conta = Box.create({ vaultId: vault.id, name: 'Conta', isDefault: true });
    cartao = Box.create({ vaultId: vault.id, name: 'Outro' });
    vault.addBox(conta);
    vault.addBox(cartao);
    vault.setBudget(mercado, 5000);
  });

  const purchase = (amount: number, date: Date, boxId = conta.id) => {
    const tx = Transaction.create({
      vaultId: vault.id,
      amount,
      type: 'expense',
      date,
      boxId,
      categoryId: mercado.id,
      description: 'Compra',
    });
    vault.addTransaction(tx);
    vault.commitTransaction(tx.id);
    return tx;
  };

  const register = (amount = 3200) => {
    const [error, invoice] = vault.registerInvoice({
      amount,
      paymentDate: day(9, 10),
      boxId: conta.id,
    });
    expect(error).toBeNull();
    return invoice!;
  };

  const remainderOf = (invoiceId: string) =>
    [...vault.transactions.values()].find(
      (t) => t.invoiceId === invoiceId && t.isInvoiceRemainder,
    );

  const spentOn = (period: { month: number; year: number }) =>
    vault.totalSpentAmount(period, { includeAll: true });

  const budgetSpentOn = (period: { month: number; year: number }) =>
    vault.getBudgetsSummary(period.month, period.year)[0].spent;

  it('should count the whole invoice as spending on the payment date', () => {
    const invoice = register();

    const remainder = remainderOf(invoice.id)!;
    expect(remainder.amount).toBe(3200);
    expect(remainder.date).toEqual(day(9, 10));
    expect(remainder.boxId).toBe(conta.id);
    expect(remainder.categoryId).toBeNull();
    expect(remainder.isCommitted).toBe(true);
    expect(spentOn(SEPTEMBER)).toBe(3200);
    expect(vault.getBoxBalance(conta.id)).toBe(-3200);
  });

  it('should reject a non-positive amount or an unknown estrato', () => {
    expect(
      vault.registerInvoice({
        amount: 0,
        paymentDate: day(9, 10),
        boxId: conta.id,
      })[0],
    ).not.toBeNull();
    expect(
      vault.registerInvoice({
        amount: 10,
        paymentDate: day(9, 10),
        boxId: 'x',
      })[0],
    ).not.toBeNull();
  });

  it('should move August purchases to the September payment and keep the month total', () => {
    const invoice = register();
    const a = purchase(1000, day(8, 12));
    const b = purchase(1050, day(8, 20), cartao.id);

    vault.linkToInvoice(a.id, invoice.id);
    vault.linkToInvoice(b.id, invoice.id);

    // As compras contam na data de pagamento, no estrato que pagou.
    expect(a.date).toEqual(day(9, 10));
    expect(a.purchaseDate).toEqual(day(8, 12));
    expect(b.boxId).toBe(conta.id);
    expect(remainderOf(invoice.id)!.amount).toBe(1150);

    expect(spentOn(AUGUST)).toBe(0);
    expect(spentOn(SEPTEMBER)).toBe(3200);
    // O orçamento por categoria também conta em setembro.
    expect(budgetSpentOn(AUGUST)).toBe(0);
    expect(budgetSpentOn(SEPTEMBER)).toBe(2050);
    expect(vault.getBoxBalance(conta.id)).toBe(-3200);
    expect(vault.getInvoiceBreakdown(invoice.id)).toMatchObject({
      itemized: 2050,
      remainder: 1150,
      status: 'partial',
    });
  });

  it('should drop the remainder once the purchases cover the invoice', () => {
    const invoice = register();
    vault.linkToInvoice(purchase(2000, day(8, 1)).id, invoice.id);
    vault.linkToInvoice(purchase(1200, day(8, 2)).id, invoice.id);

    expect(remainderOf(invoice.id)).toBeUndefined();
    expect(spentOn(SEPTEMBER)).toBe(3200);
    expect(vault.getInvoiceBreakdown(invoice.id)!.status).toBe('detailed');
  });

  it('should surface purchases beyond the invoice without a negative remainder', () => {
    const invoice = register();
    vault.linkToInvoice(purchase(3500, day(8, 1)).id, invoice.id);

    expect(remainderOf(invoice.id)).toBeUndefined();
    expect(vault.getInvoiceBreakdown(invoice.id)).toMatchObject({
      remainder: 0,
      excess: 300,
      status: 'exceeded',
    });
  });

  it('should start reduced when the purchases were confirmed before the payment', () => {
    const a = purchase(3000, day(8, 12));
    expect(spentOn(AUGUST)).toBe(3000);

    const invoice = register();
    vault.linkToInvoice(a.id, invoice.id);

    expect(remainderOf(invoice.id)!.amount).toBe(200);
    expect(spentOn(AUGUST)).toBe(0);
    expect(spentOn(SEPTEMBER)).toBe(3200);
  });

  it('should grow the remainder back when a linked purchase is deleted', () => {
    const invoice = register();
    const a = purchase(3200, day(8, 12));
    vault.linkToInvoice(a.id, invoice.id);
    expect(remainderOf(invoice.id)).toBeUndefined();

    vault.deleteTransaction(a.id);

    expect(remainderOf(invoice.id)!.amount).toBe(3200);
    expect(spentOn(SEPTEMBER)).toBe(3200);
  });

  it('should recompute when a linked purchase amount is edited', () => {
    const invoice = register();
    const a = purchase(1000, day(8, 12));
    vault.linkToInvoice(a.id, invoice.id);

    vault.editTransaction(a.id, { amount: 1200 });

    expect(remainderOf(invoice.id)!.amount).toBe(2000);
  });

  it('should edit the purchase date, not the counting date, of a linked purchase', () => {
    const invoice = register();
    const a = purchase(1000, day(8, 12));
    vault.linkToInvoice(a.id, invoice.id);

    vault.editTransaction(a.id, { date: day(8, 14) });

    expect(a.purchaseDate).toEqual(day(8, 14));
    expect(a.date).toEqual(day(9, 10));
  });

  it('should refuse editing the remainder, which the invoice computes', () => {
    const invoice = register();
    const [error] = vault.editTransaction(remainderOf(invoice.id)!.id, {
      amount: 10,
    });
    expect(error).not.toBeNull();
    expect(remainderOf(invoice.id)!.amount).toBe(3200);
  });

  it('should put an unlinked purchase back on its own date', () => {
    const invoice = register();
    const a = purchase(1000, day(8, 12));
    vault.linkToInvoice(a.id, invoice.id);

    vault.unlinkFromInvoice(a.id);

    expect(a.date).toEqual(day(8, 12));
    expect(a.purchaseDate).toBeNull();
    expect(a.invoiceId).toBeNull();
    expect(remainderOf(invoice.id)!.amount).toBe(3200);
  });

  it('should move a purchase between invoices without counting it twice', () => {
    const first = register(1000);
    const second = register(500);
    const a = purchase(300, day(8, 12));

    vault.linkToInvoice(a.id, first.id);
    vault.linkToInvoice(a.id, second.id);

    expect(remainderOf(first.id)!.amount).toBe(1000);
    expect(remainderOf(second.id)!.amount).toBe(200);
    expect(a.purchaseDate).toEqual(day(8, 12));
    expect(spentOn(SEPTEMBER)).toBe(1500);
  });

  it('should delete the invoice when its remainder is deleted, restoring purchase dates', () => {
    const invoice = register();
    const a = purchase(1000, day(8, 12));
    vault.linkToInvoice(a.id, invoice.id);

    const [error] = vault.deleteTransaction(remainderOf(invoice.id)!.id);

    expect(error).toBeNull();
    expect(vault.invoices.has(invoice.id)).toBe(false);
    expect(remainderOf(invoice.id)).toBeUndefined();
    expect(a.date).toEqual(day(8, 12));
    expect(a.invoiceId).toBeNull();
    expect(spentOn(AUGUST)).toBe(1000);
    expect(spentOn(SEPTEMBER)).toBe(0);
  });

  it('should not link a transfer', () => {
    const invoice = register();
    const [, transferId] = vault.createTransfer({
      fromBoxId: conta.id,
      toBoxId: cartao.id,
      amount: 100,
      date: day(8, 1),
    });
    const leg = [...vault.transactions.values()].find(
      (t) => t.transferId === transferId,
    )!;
    expect(vault.linkToInvoice(leg.id, invoice.id)[0]).not.toBeNull();
  });
});
