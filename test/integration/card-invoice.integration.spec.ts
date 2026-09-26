/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import * as schema from '@/shared/persistence/drizzle/schema';
import { VaultQueryService } from '@/vault/shared/vault-query.service';
import { INestApplication } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestVault,
  startTestApp,
  stopTestApp,
  truncateAll,
} from './setup';

type Line = { fitId: string; amount: string; memo: string; date: string };

const stmttrn = (lines: Line[]) =>
  lines
    .map(
      (line) => `<STMTTRN>
<TRNTYPE>${line.amount.startsWith('-') ? 'DEBIT' : 'CREDIT'}
<DTPOSTED>${line.date}000000[-3:BRT]
<TRNAMT>${line.amount}
<FITID>${line.fitId}
<MEMO>${line.memo}
</STMTTRN>`,
    )
    .join('\n');

/** Extrato da conta corrente (agosto e setembro), OFX 1.x em ISO-8859-1. */
function checkingOfx(lines: Line[]): string {
  return Buffer.from(
    `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM><BANKID>0260<ACCTID>1234567-8<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260801
<DTEND>20260930
${stmttrn(lines)}
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`,
    'latin1',
  ).toString('base64');
}

/** Extrato do cartão: fatura de 03/08 a 02/09. */
function cardOfx(lines: Line[]): string {
  return Buffer.from(
    `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
<CURDEF>BRL
<CCACCTFROM><ACCTID>5c9e-cartao</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260803
<DTEND>20260902
${stmttrn(lines)}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>-3200.00<DTASOF>20260902</LEDGERBAL>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`,
    'latin1',
  ).toString('base64');
}

// Exemplo da spec: compras de 700, 500 e 2.000 em agosto; pagamentos de
// 1.000 (antecipado, 15/08) e 2.200 (10/09). A compra de 500 se divide.
const PURCHASES: Line[] = [
  { fitId: 'C1', amount: '-700.00', memo: 'MERCADO BOM', date: '20260805' },
  { fitId: 'C2', amount: '-500.00', memo: 'CINEMA', date: '20260812' },
  { fitId: 'C3', amount: '-2000.00', memo: 'MERCADO BOM', date: '20260820' },
  {
    fitId: 'C4',
    amount: '900.00',
    memo: 'Pagamento recebido',
    date: '20260809',
  },
];
const PAYMENTS: Line[] = [
  {
    fitId: 'P1',
    amount: '-1000.00',
    memo: 'PAGAMENTO FATURA',
    date: '20260815',
  },
  {
    fitId: 'P2',
    amount: '-2200.00',
    memo: 'PAGAMENTO FATURA',
    date: '20260910',
  },
];

describe('Cartões, faturas e pagamentos (integration)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let vaultToken: string;
  let vaultId: string;
  let boxId: string;
  let mercado: string;
  let lazer: string;

  const auth = (req: request.Test) =>
    req.set('Cookie', `vault_access_token=${vaultToken}`);
  const post = (path: string, body: object = {}) =>
    auth(request(app.getHttpServer()).post(path).send(body));
  const get = (path: string) => auth(request(app.getHttpServer()).get(path));

  const upload = async (contentBase64: string) => {
    const response = await post('/vault/import/upload', {
      contentBase64,
      fileName: 'extrato.ofx',
      boxId,
    });
    expect(response.status).toBe(201);
    return response.body.batches[0];
  };

  const createTx = async (body: object): Promise<string> => {
    const response = await post('/vault/create-transaction', body);
    expect(response.status).toBe(201);
    return response.body.transaction?.id ?? response.body.id;
  };

  /** Importa o extrato do cartão, categoriza por estabelecimento e confirma. */
  const importCard = async () => {
    const batch = await upload(cardOfx(PURCHASES));
    const groups = (await get(`/vault/import/batch/${batch.id}/groups`)).body
      .groups;
    for (const group of groups) {
      await post('/vault/import/entries/categorize', {
        entryIds: group.entryIds,
        categoryId: group.description === 'CINEMA' ? lazer : mercado,
      });
    }
    await post('/vault/import/batch/confirm', { batchId: batch.id }).expect(
      201,
    );
    return batch;
  };

  /** Importa os débitos da conta corrente e os confirma como pagamentos. */
  const importPayments = async (lines: Line[] = PAYMENTS) => {
    const batch = await upload(checkingOfx(lines));
    const groups = (await get(`/vault/import/batch/${batch.id}/groups`)).body
      .groups;
    expect(groups[0].suggestsInvoice).toBe(true);
    const response = await post('/vault/import/confirm-invoice-payment', {
      entryIds: groups[0].entryIds,
    }).expect(201);
    expect(response.body.confirmed).toBe(lines.length);
    return response.body;
  };

  const summary = async (month: number) => {
    const response = await get(`/vault/summary?year=2026&month=${month}`);
    expect(response.status).toBe(200);
    const byCategory = (id: string) =>
      response.body.budget.find((b: any) => b.category.id === id)?.spent;
    return {
      spent: response.body.vault.totalSpentAmount as number,
      income: response.body.vault.totalIncomeAmount as number,
      mercado: byCategory(mercado) as number,
      lazer: byCategory(lazer) as number,
      balance: response.body.vault.balance as number,
    };
  };

  const costOfLiving = async (month: number) => {
    const [data] = await app.get(VaultQueryService).aggregateByPeriod(
      vaultId,
      [
        {
          month: 0,
          startDate: new Date(Date.UTC(2026, month - 1, 1)),
          endDate: new Date(Date.UTC(2026, month, 1)),
        },
      ],
      [],
    );
    return data.realCostOfLiving;
  };

  beforeAll(async () => {
    const result = await startTestApp();
    app = result.app;
    db = result.db;
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const vault = await createTestVault(db);
    vaultToken = vault.token;
    vaultId = vault.id;
    boxId = crypto.randomUUID();
    await db.insert(schema.box).values({
      id: boxId,
      vaultId,
      name: 'Nubank',
      isDefault: true,
      type: 'spending',
      createdAt: new Date(),
    });
    mercado = crypto.randomUUID();
    lazer = crypto.randomUUID();
    await db.insert(schema.vaultCategory).values([
      {
        id: mercado,
        vaultId,
        name: 'Mercado',
        code: 'm',
        transactionType: 'expense',
      },
      {
        id: lazer,
        vaultId,
        name: 'Lazer',
        code: 'l',
        transactionType: 'expense',
      },
    ]);
    await db.insert(schema.budget).values([
      { vaultId, categoryId: mercado, amount: 5000 },
      { vaultId, categoryId: lazer, amount: 5000 },
    ]);
  });

  it('compras não pagas não contam: ficam a pagar e saem do saldo disponível', async () => {
    const batch = await importCard();

    const cards = (await get('/vault/cards')).body.cards;
    expect(cards).toEqual([
      expect.objectContaining({
        name: 'Cartão 5c9e-cartao',
        closingDay: 2,
        dueDay: 9,
        boxId,
        payable: 3200,
      }),
    ]);
    const august = await summary(8);
    expect(august).toMatchObject({ spent: 0, mercado: 0, lazer: 0, income: 0 });
    expect(await costOfLiving(8)).toBe(0);
    expect(
      (await get('/vault/transactions?year=2026&month=8')).body.items,
    ).toEqual([]);

    const available = (await get('/vault/available-balance')).body;
    expect(available.total).toEqual({
      balance: 0,
      cardPayable: 3200,
      available: -3200,
    });
    expect(available.estratos[0]).toMatchObject({
      boxId,
      cardPayable: 3200,
      available: -3200,
    });

    const invoices = (await get('/vault/invoices')).body;
    expect(invoices.invoices).toEqual([
      expect.objectContaining({
        id: batch.invoiceId,
        closingDate: '2026-09-02T00:00:00.000Z',
        purchasesTotal: 3200,
        paid: 0,
        unpaidPurchases: 3200,
      }),
    ]);
  });

  it('uma compra dividida entre dois pagamentos conta nos dois meses: orçamento, total, plano e listagem', async () => {
    const batch = await importCard();
    const result = await importPayments();
    // Os dois pagamentos foram para a fatura do extrato (o de 15/08 antecipado).
    expect(result.invoiceIds).toEqual([batch.invoiceId]);

    const august = await summary(8);
    const september = await summary(9);
    expect(august).toMatchObject({ spent: 1000, mercado: 700, lazer: 300 });
    expect(september).toMatchObject({
      spent: 2200,
      mercado: 2000,
      lazer: 200,
    });
    expect(await costOfLiving(8)).toBe(1000);
    expect(await costOfLiving(9)).toBe(2200);
    expect(august.income + september.income).toBe(0);
    expect(september.balance).toBe(-3200);

    // A listagem mostra as partes com a data e o valor da compra.
    const sept = (await get('/vault/transactions?year=2026&month=9')).body
      .items;
    expect(sept.reduce((s: number, t: any) => s + t.amount, 0)).toBe(2200);
    const cinemaSept = sept.find((t: any) => t.description === 'CINEMA');
    expect(cinemaSept).toMatchObject({
      amount: 200,
      invoiceRole: 'part',
      purchaseDate: '2026-08-12T00:00:00.000Z',
      purchaseAmount: 500,
      date: '2026-09-10T00:00:00.000Z',
    });
    const aug = (await get('/vault/transactions?year=2026&month=8')).body.items;
    expect(aug.find((t: any) => t.description === 'CINEMA').amount).toBe(300);

    const detail = (await get(`/vault/invoices/${batch.invoiceId}`)).body;
    expect(detail.invoice).toMatchObject({
      status: 'paid',
      total: 3200,
      paid: 3200,
      remaining: 0,
      notItemized: 0,
      paymentCount: 2,
    });
    const cinema = detail.purchases.find(
      (p: any) => p.description === 'CINEMA',
    );
    expect(cinema.parts.map((p: any) => p.amount)).toEqual([300, 200]);
    expect(detail.payments.map((p: any) => p.amount)).toEqual([1000, 2200]);

    expect((await get('/vault/available-balance')).body.total).toEqual({
      balance: -3200,
      cardPayable: 0,
      available: -3200,
    });
  });

  it('não permite editar ou excluir uma parte; editar a compra refaz as partes', async () => {
    await importCard();
    await importPayments();
    const sept = (await get('/vault/transactions?year=2026&month=9')).body
      .items;
    const part = sept.find((t: any) => t.description === 'CINEMA');

    const edit = await post('/vault/edit-transaction', {
      transactionId: part.id,
      newAmount: 1,
    });
    expect(edit.status).toBe(400);
    expect(edit.body.message).toContain(part.purchaseId);
    expect(
      (await post('/vault/delete-transaction', { transactionId: part.id }))
        .status,
    ).toBe(400);

    // Recategorizar a compra muda as duas partes.
    await post('/vault/edit-transaction', {
      transactionId: part.purchaseId,
      newCategory: 'm',
    }).expect(201);
    expect(await summary(8)).toMatchObject({ mercado: 1000, lazer: 0 });
    expect(await summary(9)).toMatchObject({ mercado: 2200, lazer: 0 });
  });

  it('pagamento sem compras conta como não discriminado; as compras o trocam sem mudar o total', async () => {
    const result = await importPayments([PAYMENTS[1]]);
    expect(await summary(9)).toMatchObject({ spent: 2200, mercado: 0 });
    const list = (await get('/vault/transactions?year=2026&month=9')).body
      .items;
    expect(list).toEqual([
      expect.objectContaining({
        amount: 2200,
        invoiceRole: 'remainder',
        category: null,
      }),
    ]);
    expect(
      (await post('/vault/delete-transaction', { transactionId: list[0].id }))
        .status,
    ).toBe(400);

    const batch = await importCard();
    expect(batch.invoiceId).toBe(result.invoiceIds[0]);
    // Setembro continua 2.200, agora das compras mais antigas.
    expect(await summary(9)).toMatchObject({
      spent: 2200,
      mercado: 1700,
      lazer: 500,
    });
    expect(await summary(8)).toMatchObject({ spent: 0 });
    // Compras além do pago ficam a pagar.
    expect((await get('/vault/cards')).body.cards[0].payable).toBe(1000);
  });

  it('cadastra e edita cartão, registra, edita e remove pagamento pela API', async () => {
    const card = (
      await post('/vault/cards', {
        name: 'Roxinho',
        closingDay: 25,
        dueDay: 5,
      }).expect(201)
    ).body;
    expect(card).toMatchObject({ name: 'Roxinho', boxId, payable: 0 });
    await post(`/vault/cards/${card.id}/update`, { name: 'Nubank' }).expect(
      201,
    );
    expect(
      (await post('/vault/cards', { name: 'X', closingDay: 0, dueDay: 5 }))
        .status,
    ).toBe(400);

    const created = (
      await post('/vault/invoices/payments', {
        cardId: card.id,
        amount: 500,
        date: '2026-09-03',
      }).expect(201)
    ).body;
    expect(created.invoice).toMatchObject({
      cardName: 'Nubank',
      closingDate: '2026-08-25T00:00:00.000Z',
      dueDate: '2026-09-05T00:00:00.000Z',
      paid: 500,
      notItemized: 500,
    });
    // O mesmo pagamento de novo é recusado sem allowDuplicate.
    expect(
      (
        await post('/vault/invoices/payments', {
          cardId: card.id,
          amount: 500,
          date: '2026-09-04',
        })
      ).status,
    ).toBe(400);

    await post(`/vault/invoices/payments/${created.payment.id}/update`, {
      date: '2026-10-01',
    }).expect(201);
    expect((await summary(9)).spent).toBe(0);
    expect((await summary(10)).spent).toBe(500);

    await post(`/vault/invoices/${created.invoice.id}/update`, {
      dueDate: '2026-09-06',
    }).expect(201);
    expect(
      (
        await post(`/vault/invoices/${created.invoice.id}/update`, {
          dueDate: '2026-08-01',
        })
      ).status,
    ).toBe(400);

    await post(`/vault/invoices/payments/${created.payment.id}/delete`).expect(
      201,
    );
    expect((await summary(10)).spent).toBe(0);
    await post(`/vault/cards/${card.id}/delete`).expect(201);
    expect((await get('/vault/cards')).body.cards).toEqual([]);
  });

  it('uma despesa comum lançada à mão vira pagamento, e uma compra à mão vai para o cartão', async () => {
    const card = (
      await post('/vault/cards', { name: 'Nubank', closingDay: 2, dueDay: 9 })
    ).body;
    const expenseId = await createTx({
      amount: 800,
      type: 'expense',
      date: '2026-09-10',
      description: 'Pagamento cartão',
    });
    const purchaseId = await createTx({
      amount: 300,
      type: 'expense',
      date: '2026-08-20',
      description: 'Farmácia',
      categoryId: mercado,
    });
    expect((await summary(8)).spent).toBe(300);
    expect((await summary(9)).spent).toBe(800);

    await post('/vault/invoices/payments', {
      cardId: card.id,
      transactionId: expenseId,
    }).expect(201);
    const linked = (
      await post('/vault/invoices/link-transactions', {
        transactionIds: [purchaseId],
        cardId: card.id,
      }).expect(201)
    ).body;
    expect(linked.updated).toEqual([purchaseId]);

    expect(await summary(8)).toMatchObject({ spent: 0 });
    expect(await summary(9)).toMatchObject({ spent: 800, mercado: 300 });

    await post('/vault/invoices/unlink-transactions', {
      transactionIds: [purchaseId],
    }).expect(201);
    expect(await summary(8)).toMatchObject({ spent: 300 });
    expect(await summary(9)).toMatchObject({ spent: 800, mercado: 0 });
  });

  it('aponta a compra lançada à mão que parece duplicata de uma compra importada', async () => {
    await importCard();
    const manualId = await createTx({
      amount: 500,
      type: 'expense',
      date: '2026-08-13',
      description: 'cinema com a Ana',
    });
    await createTx({
      amount: 42,
      type: 'expense',
      date: '2026-08-13',
      description: 'Padaria',
    });

    const pairs = (await get('/vault/invoices/duplicates')).body.pairs;
    expect(pairs).toEqual([
      expect.objectContaining({
        manual: expect.objectContaining({
          transactionId: manualId,
          amount: 500,
        }),
        imported: expect.objectContaining({ description: 'CINEMA' }),
        confidence: 'high',
        dayDistance: 1,
      }),
    ]);
  });

  it('dispensa um par que não é duplicata, sem apagar os lançamentos', async () => {
    await importCard();
    const manualId = await createTx({
      amount: 500,
      type: 'expense',
      date: '2026-08-13',
      description: 'cinema com a Ana',
    });
    const [pair] = (await get('/vault/invoices/duplicates')).body.pairs;
    const body = {
      manualTransactionId: manualId,
      importedTransactionId: pair.imported.transactionId,
    };

    // Outro vault não consegue dispensar um par que não é dele.
    const other = await createTestVault(db);
    await request(app.getHttpServer())
      .post('/vault/invoices/duplicates/dismiss')
      .set('Cookie', `vault_access_token=${other.token}`)
      .send(body)
      .expect(400);
    // Um par inventado também não.
    await post('/vault/invoices/duplicates/dismiss', {
      ...body,
      importedTransactionId: manualId,
    }).expect(400);

    await post('/vault/invoices/duplicates/dismiss', body).expect(201);
    expect((await get('/vault/invoices/duplicates')).body.pairs).toEqual([]);

    // Os dois lançamentos continuam; a dispensa some com eles.
    const rows = await db.select().from(schema.transaction);
    expect(rows.map((t) => t.id)).toEqual(
      expect.arrayContaining([manualId, pair.imported.transactionId]),
    );
    expect(await db.select().from(schema.duplicateDismissal)).toHaveLength(1);
    await post('/vault/delete-transaction', {
      transactionId: manualId,
    }).expect(201);
    expect(await db.select().from(schema.duplicateDismissal)).toHaveLength(0);
  });

  it('confere a fatura com o extrato: linhas faltando e compras à mão', async () => {
    const batch = await upload(cardOfx(PURCHASES));
    const pending = (
      await get(`/vault/import/batch/${batch.id}?status=pending`)
    ).body.entries.items;
    // Confirma só a primeira; as outras seguem pendentes.
    await post('/vault/import/confirm', { entryIds: [pending[0].id] }).expect(
      201,
    );
    const manualId = await createTx({
      amount: 15,
      type: 'expense',
      date: '2026-08-21',
      description: 'Café',
    });
    await post('/vault/invoices/link-transactions', {
      transactionIds: [manualId],
      invoiceId: batch.invoiceId,
    }).expect(201);

    const view = (await get(`/vault/invoices/${batch.invoiceId}/reconcile`))
      .body;
    expect(view.missing.map((m: any) => m.reason)).toEqual([
      'pending',
      'pending',
    ]);
    expect(view.extra).toEqual([
      expect.objectContaining({ description: 'Café', amount: 15 }),
    ]);
    expect(view.statements[0]).toMatchObject({
      statementTotal: 3200,
      ledgerMatchesTotal: false,
    });
  });

  describe('histórico de antes dos cartões', () => {
    /**
     * Como o import funcionava antes: extrato do cartão sem fatura, compras
     * confirmadas na data da compra e o débito da fatura ignorado na triagem.
     */
    const seedLegacy = async () => {
      const cardBatch = crypto.randomUUID();
      const bankBatch = crypto.randomUUID();
      await db.insert(schema.importBatch).values([
        {
          id: cardBatch,
          vaultId,
          accountKey: ':5c9e-cartao:',
          accountLabel: 'Cartão antigo',
          boxId,
          kind: 'creditcard',
          periodStart: new Date(Date.UTC(2026, 6, 3)),
          periodEnd: new Date(Date.UTC(2026, 7, 2)),
          status: 'done',
          createdAt: new Date(),
        },
        {
          id: bankBatch,
          vaultId,
          accountKey: '0260:1:CHECKING',
          boxId,
          kind: 'bank',
          status: 'done',
          createdAt: new Date(),
        },
      ]);
      const purchases = [
        { amount: 400, date: new Date(Date.UTC(2026, 6, 10)), fitId: 'L1' },
        { amount: 600, date: new Date(Date.UTC(2026, 6, 25)), fitId: 'L2' },
      ];
      for (const p of purchases) {
        const txId = crypto.randomUUID();
        await db.insert(schema.transaction).values({
          id: txId,
          code: p.fitId,
          amount: p.amount,
          type: 'expense',
          vaultId,
          categoryId: mercado,
          description: 'COMPRA',
          createdAt: new Date(),
          committed: true,
          date: p.date,
          boxId,
        });
        await db.insert(schema.importEntry).values({
          id: crypto.randomUUID(),
          batchId: cardBatch,
          vaultId,
          accountKey: ':5c9e-cartao:',
          fitId: p.fitId,
          rawDate: p.date,
          rawAmount: -p.amount,
          rawType: 'expense',
          rawMemo: 'COMPRA',
          date: p.date,
          amount: p.amount,
          type: 'expense',
          description: 'COMPRA',
          boxId,
          status: 'confirmed',
          transactionId: txId,
          createdAt: new Date(),
        });
      }
      const payDate = new Date(Date.UTC(2026, 7, 9));
      await db.insert(schema.importEntry).values({
        id: crypto.randomUUID(),
        batchId: bankBatch,
        vaultId,
        accountKey: '0260:1:CHECKING',
        fitId: 'LP',
        rawDate: payDate,
        rawAmount: -1000,
        rawType: 'expense',
        rawMemo: 'PAGAMENTO FATURA',
        date: payDate,
        amount: 1000,
        type: 'expense',
        description: 'PAGAMENTO FATURA',
        boxId,
        status: 'dismissed',
        createdAt: new Date(),
      });
    };

    it('mostra a prévia por mês sem gravar, e aplica só quando pedido', async () => {
      await seedLegacy();
      expect(
        (await get('/vault/invoices')).body.pendingStatements,
      ).toHaveLength(1);

      const preview = (await get('/vault/invoices/reprocess/preview')).body;
      expect(preview.months).toEqual([
        { year: 2026, month: 7, before: 1000, after: 0 },
        { year: 2026, month: 8, before: 0, after: 1000 },
      ]);
      expect(preview.statements).toEqual([
        expect.objectContaining({
          newCard: true,
          purchaseCount: 2,
          total: 1000,
        }),
      ]);
      expect(preview.payments).toEqual([
        expect.objectContaining({ amount: 1000, source: 'dismissed' }),
      ]);
      // Nada gravado.
      expect((await summary(7)).spent).toBe(1000);
      expect((await get('/vault/cards')).body.cards).toEqual([]);

      const applied = (
        await post('/vault/invoices/reprocess/apply').expect(201)
      ).body;
      expect(applied.months).toEqual(preview.months);
      expect(await summary(7)).toMatchObject({ spent: 0 });
      expect(await summary(8)).toMatchObject({ spent: 1000, mercado: 1000 });
      expect((await get('/vault/invoices')).body.pendingStatements).toEqual([]);

      // Aplicar de novo não muda nada.
      const again = (await get('/vault/invoices/reprocess/preview')).body;
      expect(again).toMatchObject({ statements: [], payments: [], months: [] });
    });

    it('extrato antigo marcado "sem fatura" sai dos pendentes e do reprocessamento', async () => {
      await seedLegacy();
      const [pending] = (await get('/vault/invoices')).body.pendingStatements;
      await post('/vault/import/batch/no-invoice', {
        batchId: pending.batchId,
      }).expect(201);
      expect((await get('/vault/invoices')).body.pendingStatements).toEqual([]);
      const preview = (await get('/vault/invoices/reprocess/preview')).body;
      expect(preview.statements).toEqual([]);
    });
  });
});
