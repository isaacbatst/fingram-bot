/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import * as schema from '@/shared/persistence/drizzle/schema';
import { VaultQueryService } from '@/vault/shared/vault-query.service';
import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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

/** Extrato da conta corrente, OFX 1.x SGML em ISO-8859-1. */
function checkingOfx(lines: Line[]): string {
  const content = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0260
<ACCTID>1234567-8
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260901
<DTEND>20260930
${stmttrn(lines)}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>1000.00
<DTASOF>20260930
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;
  return Buffer.from(content, 'latin1').toString('base64');
}

/** Extrato do cartão (a fatura de agosto), com o total em LEDGERBAL. */
function cardOfx(lines: Line[], ledgerBalance: string | null): string {
  const balance =
    ledgerBalance === null
      ? ''
      : `<LEDGERBAL>
<BALAMT>${ledgerBalance}
<DTASOF>20260902
</LEDGERBAL>`;
  const content = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CURDEF>BRL
<CCACCTFROM>
<ACCTID>5c9e-cartao
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260803
<DTEND>20260902
${stmttrn(lines)}
</BANKTRANLIST>
${balance}
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`;
  return Buffer.from(content, 'latin1').toString('base64');
}

const PAYMENT: Line = {
  fitId: 'P1',
  amount: '-3200.00',
  memo: 'PAGAMENTO FATURA',
  date: '20260910',
};

const PURCHASES: Line[] = [
  { fitId: 'C1', amount: '-1000.00', memo: 'MERCADO BOM', date: '20260812' },
  { fitId: 'C2', amount: '-1050.00', memo: 'POSTO SHELL', date: '20260820' },
  // Quitação da fatura anterior, vista de dentro do cartão.
  {
    fitId: 'C3',
    amount: '2900.00',
    memo: 'Pagamento recebido',
    date: '20260805',
  },
];

describe('Fatura de cartão (integration)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let vaultToken: string;
  let vaultId: string;
  let boxId: string;
  let categoryId: string;

  const auth = (req: request.Test, token = vaultToken) =>
    req.set('Cookie', `vault_access_token=${token}`);

  const post = async (path: string, body: object, token?: string) =>
    auth(request(app.getHttpServer()).post(path).send(body), token);

  const get = async (path: string, token?: string) =>
    auth(request(app.getHttpServer()).get(path), token);

  const upload = async (contentBase64: string) => {
    const response = await post('/vault/import/upload', {
      contentBase64,
      fileName: 'extrato.ofx',
      boxId,
    });
    expect(response.status).toBe(201);
    return response.body.batches[0];
  };

  const pendingIds = async (batchId: string): Promise<string[]> => {
    const response = await get(`/vault/import/batch/${batchId}?status=pending`);
    return response.body.entries.items.map((e: { id: string }) => e.id);
  };

  /** Importa o débito da conta corrente e registra a fatura a partir dele. */
  const registerInvoice = async (payment: Line = PAYMENT) => {
    const batch = await upload(checkingOfx([payment]));
    const groups = await get(`/vault/import/batch/${batch.id}/groups`);
    expect(groups.body.groups[0].suggestsInvoice).toBe(true);

    const response = await post('/vault/import/confirm-invoice', {
      entryIds: groups.body.groups[0].entryIds,
    });
    expect(response.status).toBe(201);
    expect(response.body.confirmed).toBe(1);
    return response.body.invoiceIds[0] as string;
  };

  /** Importa o extrato do cartão, categoriza as compras e confirma tudo. */
  const importCard = async (ledgerBalance: string | null = '-3200.00') => {
    const batch = await upload(cardOfx(PURCHASES, ledgerBalance));
    const ids = await pendingIds(batch.id);
    await post('/vault/import/entries/categorize', {
      entryIds: ids,
      categoryId,
    });
    const confirm = await post('/vault/import/batch/confirm', {
      batchId: batch.id,
    });
    expect(confirm.status).toBe(201);
    return batch;
  };

  const summary = async (month: number, token?: string) => {
    const response = await get(
      `/vault/summary?year=2026&month=${month}`,
      token,
    );
    expect(response.status).toBe(200);
    return {
      spent: response.body.vault.totalSpentAmount as number,
      income: response.body.vault.totalIncomeAmount as number,
      budgetSpent: response.body.budget[0]?.spent as number,
    };
  };

  const invoices = async (token?: string) => {
    const response = await get('/vault/invoices', token);
    expect(response.status).toBe(200);
    return response.body;
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

    categoryId = crypto.randomUUID();
    await db.insert(schema.vaultCategory).values({
      id: categoryId,
      vaultId,
      name: 'Compras',
      code: '2',
      transactionType: 'expense',
    });
    await db
      .insert(schema.budget)
      .values({ vaultId, categoryId, amount: 5000 });
  });

  it('should count the registered invoice as the month spending, undetailed', async () => {
    const invoiceId = await registerInvoice();

    expect((await summary(9)).spent).toBe(3200);
    expect(await costOfLiving(9)).toBe(3200);

    const body = await invoices();
    expect(body.invoices).toEqual([
      expect.objectContaining({
        id: invoiceId,
        amount: 3200,
        remainder: 3200,
        status: 'awaiting',
      }),
    ]);

    const list = await get('/vault/transactions?year=2026&month=9');
    expect(list.body.items).toEqual([
      expect.objectContaining({
        amount: 3200,
        invoiceId,
        invoiceRole: 'remainder',
        category: null,
      }),
    ]);
  });

  it('should shrink the remainder as the card purchases are confirmed, keeping the total', async () => {
    const invoiceId = await registerInvoice();
    const batch = await importCard();
    expect(batch.invoiceId).toBe(invoiceId);

    // Compras de agosto de uma fatura paga em setembro contam em setembro,
    // no orçamento e no plano.
    const august = await summary(8);
    const september = await summary(9);
    expect(august.spent).toBe(0);
    expect(august.budgetSpent).toBe(0);
    expect(september.spent).toBe(3200);
    expect(september.budgetSpent).toBe(2050);
    expect(await costOfLiving(8)).toBe(0);
    expect(await costOfLiving(9)).toBe(3200);

    // "Pagamento recebido" nunca vira receita.
    expect(august.income + september.income).toBe(0);

    const body = await invoices();
    expect(body.invoices[0]).toMatchObject({
      itemized: 2050,
      remainder: 1150,
      purchaseCount: 2,
      status: 'partial',
    });

    // A data da compra continua disponível.
    const list = await get('/vault/transactions?year=2026&month=9');
    const mercado = list.body.items.find(
      (t: { description: string }) => t.description === 'MERCADO BOM',
    );
    expect(mercado.invoiceRole).toBe('purchase');
    expect(mercado.date.slice(0, 10)).toBe('2026-09-10');
    expect(mercado.purchaseDate.slice(0, 10)).toBe('2026-08-12');
  });

  it('should leave no remainder once fully itemized', async () => {
    const invoiceId = await registerInvoice({ ...PAYMENT, amount: '-2050.00' });
    await importCard(null);

    const body = await invoices();
    expect(body.invoices[0]).toMatchObject({
      remainder: 0,
      status: 'detailed',
    });
    const rows = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.invoiceId, invoiceId));
    expect(rows.every((r) => r.purchaseDate !== null)).toBe(true);
    expect((await summary(9)).spent).toBe(2050);
  });

  it('should surface purchases exceeding the paid amount', async () => {
    await registerInvoice({ ...PAYMENT, amount: '-2000.00' });
    const batch = await upload(cardOfx(PURCHASES, null));
    // Nada bate sozinho (2.050 ≠ 2.000): o usuário liga à mão.
    expect(batch.invoiceId).toBeNull();
    const {
      invoices: [invoice],
    } = await invoices();
    const link = await post('/vault/import/batch/invoice', {
      batchId: batch.id,
      invoiceId: invoice.id,
    });
    expect(link.status).toBe(201);
    await post('/vault/import/batch/confirm', { batchId: batch.id });

    const body = await invoices();
    expect(body.invoices[0]).toMatchObject({
      remainder: 0,
      excess: 50,
      status: 'exceeded',
    });
    expect((await summary(9)).spent).toBe(2050);
  });

  it('should pick up a card statement imported before the payment', async () => {
    // O LEDGERBAL do cartão (o total da fatura) é o que casa com o pagamento.
    await importCard('-3200.00');
    expect((await summary(8)).spent).toBe(2050);
    expect((await invoices()).unlinkedStatements).toEqual([
      expect.objectContaining({ purchaseCount: 2, total: 2050 }),
    ]);

    await registerInvoice();

    expect((await summary(8)).spent).toBe(0);
    expect((await summary(9)).spent).toBe(3200);
    const body = await invoices();
    expect(body.invoices[0]).toMatchObject({ remainder: 1150 });
    expect(body.unlinkedStatements).toHaveLength(0);
  });

  it('should grow the remainder back when a linked purchase is deleted', async () => {
    await registerInvoice();
    await importCard();
    const list = await get('/vault/transactions?year=2026&month=9');
    const posto = list.body.items.find(
      (t: { description: string }) => t.description === 'POSTO SHELL',
    );

    await post('/vault/delete-transaction', { transactionCode: posto.code });

    expect((await invoices()).invoices[0].remainder).toBe(2200);
    expect((await summary(9)).spent).toBe(3200);
  });

  it('should delete the invoice and bring the purchases back to August', async () => {
    const invoiceId = await registerInvoice();
    await importCard();

    const response = await post('/vault/invoices/delete', { invoiceId });
    expect(response.status).toBe(201);

    expect((await summary(8)).spent).toBe(2050);
    expect((await summary(9)).spent).toBe(0);
    const body = await invoices();
    expect(body.invoices).toHaveLength(0);
    expect(body.unlinkedStatements).toHaveLength(1);
  });

  it('should keep invoices isolated between vaults', async () => {
    const invoiceId = await registerInvoice();
    const other = await createTestVault(db);

    expect((await invoices(other.token)).invoices).toHaveLength(0);
    const response = await post(
      '/vault/invoices/delete',
      { invoiceId },
      other.token,
    );
    expect(response.status).toBe(400);
    expect((await invoices()).invoices).toHaveLength(1);
  });
});
