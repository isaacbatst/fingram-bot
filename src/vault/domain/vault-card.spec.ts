import { beforeEach, describe, expect, it } from 'vitest';
import { Vault } from './vault';
import { Transaction } from './transaction';
import { Category } from './category';
import { Box } from './box';
import { Card } from './card';

const day = (month: number, date: number) =>
  new Date(Date.UTC(2026, month - 1, date));

const AUGUST = { month: 8, year: 2026 };
const SEPTEMBER = { month: 9, year: 2026 };

describe('Vault — cartões, faturas e pagamentos', () => {
  let vault: Vault;
  let conta: Box;
  let card: Card;
  const mercado = new Category('c-mercado', 'Mercado', '2');
  const lazer = new Category('c-lazer', 'Lazer', '3');

  beforeEach(() => {
    vault = new Vault();
    conta = Box.create({ vaultId: vault.id, name: 'Conta', isDefault: true });
    vault.addBox(conta);
    vault.setBudget(mercado, 5000);
    vault.setBudget(lazer, 5000);
    const [error, created] = vault.addCard({
      name: 'Nubank',
      closingDay: 31,
      dueDay: 10,
    });
    expect(error).toBeNull();
    card = created!;
  });

  const expense = (
    amount: number,
    date: Date,
    categoryId: string | null = mercado.id,
  ) => {
    const tx = Transaction.create({
      vaultId: vault.id,
      amount,
      type: 'expense',
      date,
      boxId: conta.id,
      categoryId,
      description: 'Compra',
    });
    vault.addTransaction(tx);
    vault.commitTransaction(tx.id);
    return tx;
  };

  const cardPurchase = (
    amount: number,
    date: Date,
    categoryId: string | null = mercado.id,
  ) => {
    const tx = expense(amount, date, categoryId);
    const [error] = vault.linkPurchase(tx.id, { cardId: card.id });
    expect(error).toBeNull();
    return tx;
  };

  const pay = (amount: number, date: Date, invoiceId?: string) => {
    const [error, payment] = vault.addPayment({
      cardId: card.id,
      invoiceId,
      amount,
      date,
    });
    expect(error).toBeNull();
    return payment!;
  };

  const spent = (period: { month: number; year: number }) =>
    vault.totalSpentAmount(period);
  const budgetOf = (category: Category, period: typeof AUGUST) =>
    vault
      .getBudgetsSummary(period.month, period.year)
      .find((b) => b.category.id === category.id)!.spent;
  const derived = () =>
    [...vault.transactions.values()].filter((t) => t.isInvoiceDerived);

  it('compra de cartão não paga não conta em orçamento, total nem saldo', () => {
    cardPurchase(700, day(8, 5));
    expect(spent(AUGUST)).toBe(0);
    expect(budgetOf(mercado, AUGUST)).toBe(0);
    expect(vault.getBalance()).toBe(0);
    expect(vault.getBoxBalance(conta.id)).toBe(0);
    expect(vault.getCardPayable(card.id)).toBe(700);
  });

  it('exemplo da spec: a compra dividida conta em agosto e em setembro, com a categoria', () => {
    cardPurchase(700, day(8, 5), mercado.id);
    cardPurchase(500, day(8, 12), lazer.id);
    cardPurchase(2000, day(8, 20), mercado.id);
    const invoiceId = [...vault.invoices.values()][0].id;
    pay(1000, day(8, 15), invoiceId);
    pay(2200, day(9, 10), invoiceId);

    // Agosto: 700 + 300 dos 500. Setembro: os 200 restantes + 2000.
    expect(spent(AUGUST)).toBe(1000);
    expect(spent(SEPTEMBER)).toBe(2200);
    expect(budgetOf(mercado, AUGUST)).toBe(700);
    expect(budgetOf(lazer, AUGUST)).toBe(300);
    expect(budgetOf(lazer, SEPTEMBER)).toBe(200);
    expect(budgetOf(mercado, SEPTEMBER)).toBe(2000);
    expect(vault.getCardPayable(card.id)).toBe(0);
    expect(vault.getBoxBalance(conta.id)).toBe(-3200);

    const parts = derived().filter((t) => t.isInvoicePart);
    const lazerParts = parts.filter((t) => t.categoryId === lazer.id);
    expect(lazerParts.map((t) => t.amount).sort()).toEqual([200, 300]);
    expect(lazerParts.every((t) => t.purchaseDate?.getTime() === day(8, 12).getTime())).toBe(true);
  });

  it('invariante: o gasto de cartão do mês é a soma dos pagamentos do mês', () => {
    cardPurchase(123.45, day(8, 1));
    cardPurchase(67.89, day(8, 2));
    pay(100, day(8, 20));
    pay(500, day(9, 10));
    expect(spent(AUGUST)).toBe(100);
    expect(spent(SEPTEMBER)).toBe(500);
    // Setembro: o resto das compras (91,34) + 408,66 não discriminado.
    const remainder = derived().find((t) => t.isInvoiceRemainder)!;
    expect(remainder.amount).toBe(408.66);
    expect(remainder.categoryId).toBeNull();
    expect(remainder.date).toEqual(day(9, 10));
  });

  it('as compras que chegam depois trocam o não discriminado, sem mudar o total do mês', () => {
    const payment = pay(1000, day(9, 10));
    expect(spent(SEPTEMBER)).toBe(1000);
    expect(budgetOf(mercado, SEPTEMBER)).toBe(0);
    const remainderId = derived()[0].id;

    const tx = expense(400, day(8, 20));
    expect(spent(AUGUST)).toBe(400);
    vault.linkPurchase(tx.id, { invoiceId: payment.invoiceId });

    expect(spent(AUGUST)).toBe(0);
    expect(spent(SEPTEMBER)).toBe(1000);
    expect(budgetOf(mercado, SEPTEMBER)).toBe(400);
    const remainder = derived().find((t) => t.isInvoiceRemainder)!;
    // O não discriminado é a mesma linha, só encolhe.
    expect(remainder.id).toBe(remainderId);
    expect(remainder.amount).toBe(600);
  });

  it('pagamento a mais sem compras fica não discriminado e a fatura mostra paga a mais', () => {
    cardPurchase(300, day(8, 10));
    const payment = pay(500, day(9, 10));
    expect(spent(SEPTEMBER)).toBe(500);
    const figures = vault.getInvoiceFigures(card.id, day(9, 20));
    expect(figures.get(payment.invoiceId)).toMatchObject({
      status: 'overpaid',
      overpaid: 200,
      notItemized: 200,
    });
  });

  it('editar e excluir a compra refaz as partes', () => {
    const tx = cardPurchase(300, day(8, 10));
    pay(300, day(9, 10));
    expect(budgetOf(mercado, SEPTEMBER)).toBe(300);

    vault.editTransaction(tx.id, { categoryId: lazer.id, amount: 250 });
    expect(budgetOf(mercado, SEPTEMBER)).toBe(0);
    expect(budgetOf(lazer, SEPTEMBER)).toBe(250);
    expect(spent(SEPTEMBER)).toBe(300);

    vault.deleteTransaction(tx.id);
    expect(budgetOf(lazer, SEPTEMBER)).toBe(0);
    expect(spent(SEPTEMBER)).toBe(300);
    expect(derived()).toHaveLength(1);
    expect(derived()[0].isInvoiceRemainder).toBe(true);
  });

  it('recusa editar ou excluir parte e não discriminado, apontando o caminho', () => {
    const tx = cardPurchase(300, day(8, 10));
    const payment = pay(400, day(9, 10));
    const part = derived().find((t) => t.isInvoicePart)!;
    const remainder = derived().find((t) => t.isInvoiceRemainder)!;

    expect(vault.editTransaction(part.id, { amount: 1 })[0]).toContain(tx.id);
    expect(vault.deleteTransaction(part.id)[0]).toContain(tx.id);
    expect(vault.editTransaction(remainder.id, { amount: 1 })[0]).toContain(
      payment.id,
    );
    expect(vault.deleteTransaction(remainder.id)[0]).toContain(payment.id);
    expect(vault.linkPurchase(part.id, { cardId: card.id })[0]).not.toBeNull();
  });

  it('excluir o pagamento remove o que ele fazia contar; a compra volta a ser a pagar', () => {
    cardPurchase(300, day(8, 10));
    const payment = pay(400, day(9, 10));
    vault.deletePayment(payment.id);
    expect(derived()).toHaveLength(0);
    expect(spent(SEPTEMBER)).toBe(0);
    expect(vault.getCardPayable(card.id)).toBe(300);
  });

  it('mover o pagamento de data move o gasto de mês', () => {
    cardPurchase(300, day(8, 10));
    const payment = pay(300, day(8, 31));
    expect(spent(AUGUST)).toBe(300);
    vault.updatePayment(payment.id, { date: day(9, 2) });
    expect(spent(AUGUST)).toBe(0);
    expect(spent(SEPTEMBER)).toBe(300);
  });

  it('desligar a compra a faz voltar a contar na data dela', () => {
    const tx = cardPurchase(300, day(8, 10));
    pay(300, day(9, 10));
    vault.unlinkPurchase(tx.id);
    expect(spent(AUGUST)).toBe(300);
    // O pagamento continua: vira não discriminado.
    expect(spent(SEPTEMBER)).toBe(300);
  });

  it('recalcular sem mudanças não suja nada (ids e linhas estáveis)', () => {
    cardPurchase(300, day(8, 10));
    cardPurchase(200, day(8, 11));
    pay(400, day(9, 10));
    vault.clearChanges();
    vault.recomputeAllCards();
    const changes = vault.transactionsTracker.getChanges();
    expect(changes.new).toHaveLength(0);
    expect(changes.dirty).toHaveLength(0);
    expect(changes.deleted).toHaveLength(0);
  });

  it('saldo disponível desconta o que está a pagar no estrato pagador', () => {
    const income = Transaction.create({
      vaultId: vault.id,
      amount: 5000,
      type: 'income',
      date: day(8, 1),
      boxId: conta.id,
    });
    vault.addTransaction(income);
    vault.commitTransaction(income.id);
    cardPurchase(700, day(8, 5));
    cardPurchase(500, day(8, 12));
    pay(1000, day(8, 15));

    const balances = vault.getAvailableBalances();
    const estrato = balances.estratos.find((e) => e.boxId === conta.id)!;
    expect(estrato).toMatchObject({
      balance: 4000,
      cardPayable: 200,
      available: 3800,
    });
    expect(balances.total).toEqual({
      balance: 4000,
      cardPayable: 200,
      available: 3800,
    });
  });

  describe('faturas', () => {
    it('cria a fatura pelos dias do cartão sem invadir a vizinha vinda de extrato', () => {
      const [, statement] = vault.statementInvoice(
        card.id,
        { periodStart: day(8, 3), periodEnd: day(9, 2) },
        day(9, 2),
      );
      // Pelos dias do cartão (fechamento 31) seria 01/08–31/08.
      const [, before] = vault.invoiceFor(card.id, day(8, 1));
      expect(before!.id).not.toBe(statement!.id);
      expect(before!.closingDate).toEqual(day(8, 2));
      const [, after] = vault.invoiceFor(card.id, day(9, 3));
      expect(after!.periodStart).toEqual(day(9, 3));
      expect(after!.closingDate).toEqual(day(9, 30));
    });

    it('extrato com fechamento próximo ajusta a fatura existente', () => {
      const [, auto] = vault.invoiceFor(card.id, day(8, 10));
      expect(auto!.closingDate).toEqual(day(8, 31));
      const [, statement] = vault.statementInvoice(
        card.id,
        { periodStart: day(8, 1), periodEnd: day(8, 29) },
        day(8, 29),
      );
      expect(statement!.id).toBe(auto!.id);
      expect(statement!.closingDate).toEqual(day(8, 29));
    });

    it('sugere a fatura fechada para o pagamento até o vencimento; depois de paga, a aberta', () => {
      const first = pay(100, day(9, 5));
      const invoice = vault.invoices.get(first.invoiceId)!;
      expect(invoice.closingDate).toEqual(day(8, 31));

      // Nenhuma compra ainda: a fatura de agosto não está paga (total 0 é desconhecido).
      const second = pay(50, day(9, 8));
      expect(second.invoiceId).toBe(invoice.id);

      cardPurchase(100, day(8, 20));
      // Agora agosto (100) está paga: um novo pagamento é antecipação.
      const third = pay(30, day(9, 9));
      expect(vault.invoices.get(third.invoiceId)!.closingDate).toEqual(
        day(9, 30),
      );
    });

    it('não aceita vencimento antes do fechamento', () => {
      const [, invoice] = vault.invoiceFor(card.id, day(8, 10));
      expect(
        vault.updateInvoice(invoice!.id, { dueDate: day(8, 20) })[0],
      ).toMatch(/vencimento/);
    });

    it('trocar o nome do cartão atualiza o não discriminado', () => {
      pay(100, day(9, 5));
      vault.updateCard(card.id, { name: 'Roxinho' });
      expect(derived()[0].description).toBe(
        'Fatura Roxinho · não discriminado',
      );
    });

    it('cartão com compras não pode ser excluído', () => {
      cardPurchase(100, day(8, 20));
      expect(vault.deleteCard(card.id)[0]).toMatch(/compras/);
    });
  });
});
