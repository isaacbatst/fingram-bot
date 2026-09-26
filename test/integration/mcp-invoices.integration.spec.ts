/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import * as schema from '@/shared/persistence/drizzle/schema';
import { INestApplication } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash, randomBytes } from 'node:crypto';
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

function cardOfx(lines: Line[]): string {
  const balance = `<LEDGERBAL><BALAMT>-2050.00<DTASOF>20260902</LEDGERBAL>`;
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
${balance}
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`,
    'latin1',
  ).toString('base64');
}

const PURCHASES: Line[] = [
  { fitId: 'C1', amount: '-1000.00', memo: 'MERCADO BOM', date: '20260812' },
  { fitId: 'C2', amount: '-1050.00', memo: 'POSTO SHELL', date: '20260820' },
];
const REDIRECT_URI = 'http://localhost:9999/callback';

/**
 * Tools MCP de cartão, fatura e pagamento. As compras vêm do extrato do cartão
 * (ver card-invoice.integration para o fluxo REST e o import).
 */
describe('MCP: faturas de cartão (integration)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let clientId: string;

  const http = () => request(app.getHttpServer());

  type Vault = { id: string; token: string; boxId: string; categoryId: string };

  async function createVault(): Promise<Vault> {
    const vault = await createTestVault(db);
    const boxId = crypto.randomUUID();
    await db.insert(schema.box).values({
      id: boxId,
      vaultId: vault.id,
      name: 'Nubank',
      isDefault: true,
      type: 'spending',
      createdAt: new Date(),
    });
    const categoryId = crypto.randomUUID();
    await db.insert(schema.vaultCategory).values({
      id: categoryId,
      vaultId: vault.id,
      name: 'Mercado',
      code: 'mercado',
      transactionType: 'expense',
    });
    return { ...vault, boxId, categoryId };
  }

  const post = (vault: Vault, path: string, body: object) =>
    http()
      .post(path)
      .set('Cookie', `vault_access_token=${vault.token}`)
      .send(body);

  async function upload(vault: Vault, contentBase64: string) {
    const res = await post(vault, '/vault/import/upload', {
      contentBase64,
      fileName: 'extrato.ofx',
      boxId: vault.boxId,
    }).expect(201);
    return res.body.batches[0] as { id: string };
  }

  /** Importa e confirma as compras do cartão. Devolve a fatura do extrato. */
  async function importCard(vault: Vault): Promise<string> {
    const batch = await upload(vault, cardOfx(PURCHASES));
    const pending = await http()
      .get(`/vault/import/batch/${batch.id}?status=pending`)
      .set('Cookie', `vault_access_token=${vault.token}`);
    await post(vault, '/vault/import/entries/categorize', {
      entryIds: pending.body.entries.items.map((e: { id: string }) => e.id),
      categoryId: vault.categoryId,
    });
    await post(vault, '/vault/import/batch/confirm', {
      batchId: batch.id,
    }).expect(201);
    return (batch as { invoiceId: string }).invoiceId;
  }

  async function connect(vault: Vault): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorize = await http()
      .get('/authorize')
      .query({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })
      .expect(302);
    const signed = new URL(authorize.headers.location).searchParams.get(
      'oauth_request',
    );
    const approved = await http()
      .post('/oauth/consent/approve')
      .set('Cookie', `vault_access_token=${vault.token}`)
      .send({ request: signed })
      .expect(200);
    const code = new URL(approved.body.redirectUrl).searchParams.get('code');
    const token = await http()
      .post('/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
      })
      .expect(200);
    return token.body.access_token;
  }

  let rpcId = 0;
  async function callTool(
    accessToken: string,
    name: string,
    args: Record<string, unknown> = {},
  ) {
    const res = await http()
      .post('/mcp')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name, arguments: args },
      })
      .expect(200);
    const result = res.body.result;
    const text = result.content[0].text as string;
    return {
      isError: result.isError === true,
      text,
      data: result.isError ? undefined : JSON.parse(text),
    };
  }

  beforeAll(async () => {
    const result = await startTestApp();
    app = result.app;
    db = result.db;
    const res = await http()
      .post('/register')
      .send({
        client_name: 'Cliente de Teste',
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      })
      .expect(201);
    clientId = res.body.client_id;
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it('cadastra, lista e edita cartões', async () => {
    const vault = await createVault();
    const token = await connect(vault);

    const created = await callTool(token, 'createCard', {
      name: 'Roxinho',
      closingDay: 2,
      dueDay: 9,
    });
    expect(created.data).toMatchObject({
      name: 'Roxinho',
      closingDay: 2,
      dueDay: 9,
      payingEstratoId: vault.boxId,
      payable: 0,
    });
    const updated = await callTool(token, 'updateCard', {
      cardId: created.data.id,
      name: 'Nubank',
      dueDay: 10,
    });
    expect(updated.data).toMatchObject({ name: 'Nubank', dueDay: 10 });
    const list = await callTool(token, 'listCards');
    expect(list.data).toEqual([
      expect.objectContaining({ id: created.data.id, name: 'Nubank' }),
    ]);
    const bad = await callTool(token, 'createCard', {
      name: 'X',
      closingDay: 2,
      dueDay: 9,
      payingEstratoId: 'nao-existe',
    });
    expect(bad.isError).toBe(true);
  });

  it('pagamentos pelo MCP dividem a compra entre meses; breakdown, orçamento e listagem concordam', async () => {
    const vault = await createVault();
    const token = await connect(vault);
    await importCard(vault);
    const [card] = (await callTool(token, 'listCards')).data;
    expect(card.payable).toBe(2050);

    // Antecipado em 25/08 (1.500) e o resto em 10/09 (550): a compra de
    // 1.050 do posto se divide em 500 (agosto) e 550 (setembro).
    const first = await callTool(token, 'addInvoicePayment', {
      cardId: card.id,
      amount: 1500,
      date: '2026-08-25',
    });
    expect(first.isError).toBe(false);
    const invoiceId = first.data.payment.invoiceId;
    const second = await callTool(token, 'addInvoicePayment', {
      invoiceId,
      amount: 550,
      date: '2026-09-10',
    });
    expect(second.data.invoice).toMatchObject({
      status: 'paid',
      total: 2050,
      paid: 2050,
      remaining: 0,
      unpaidPurchases: 0,
    });

    const breakdown = await callTool(token, 'getSpendingBreakdown', {
      from: '2026-08-01',
      to: '2026-09-30',
      groupBy: 'month',
    });
    expect(breakdown.data.groups).toEqual([
      expect.objectContaining({
        period: { month: 8, year: 2026 },
        total: 1500,
      }),
      expect.objectContaining({ period: { month: 9, year: 2026 }, total: 550 }),
    ]);
    const budget = await callTool(token, 'getBudgetSummary', {
      month: 9,
      year: 2026,
    });
    expect(budget.data.spent).toBe(550);

    const listed = await callTool(token, 'listTransactions', {
      month: 9,
      year: 2026,
    });
    expect(listed.data.items).toEqual([
      expect.objectContaining({
        amount: 550,
        date: '2026-09-10',
        invoiceRole: 'part',
        purchaseDate: '2026-08-20',
        purchaseAmount: 1050,
        invoiceId,
        paymentId: second.data.payment.id,
      }),
    ]);

    const detail = await callTool(token, 'getInvoice', { invoiceId });
    const posto = detail.data.purchases.find(
      (p: any) => p.description === 'POSTO SHELL',
    );
    expect(posto.parts.map((p: any) => [p.amount, p.date])).toEqual([
      [500, '2026-08-25'],
      [550, '2026-09-10'],
    ]);
    expect(detail.data.payments).toHaveLength(2);

    const estratos = await callTool(token, 'listEstratos');
    expect(estratos.data[0]).toMatchObject({
      balance: -2050,
      cardPayable: 0,
      available: -2050,
    });
  });

  it('recusa editar, categorizar ou remover linhas derivadas e aponta a tool certa', async () => {
    const vault = await createVault();
    const token = await connect(vault);
    await importCard(vault);
    const [card] = (await callTool(token, 'listCards')).data;
    const paid = await callTool(token, 'addInvoicePayment', {
      cardId: card.id,
      amount: 2500,
      date: '2026-09-10',
    });
    const items = (
      await callTool(token, 'listTransactions', { month: 9, year: 2026 })
    ).data.items as any[];
    const part = items.find((t) => t.invoiceRole === 'part');
    const remainder = items.find((t) => t.invoiceRole === 'remainder');
    expect(remainder.amount).toBe(450);

    const edit = await callTool(token, 'editTransaction', {
      id: part.id,
      amount: 1,
    });
    expect(edit.isError).toBe(true);
    expect(edit.text).toContain(part.purchaseId);
    const del = await callTool(token, 'deleteTransaction', {
      id: remainder.id,
    });
    expect(del.isError).toBe(true);
    expect(del.text).toContain('deleteInvoicePayment');
    const cat = await callTool(token, 'categorizeTransactions', {
      ids: [remainder.id],
      categoryId: vault.categoryId,
    });
    expect(cat.isError).toBe(true);

    // Remover o pagamento pelo caminho certo tira tudo o que ele fazia contar.
    const removed = await callTool(token, 'deleteInvoicePayment', {
      paymentId: paid.data.payment.id,
    });
    expect(removed.isError).toBe(false);
    const after = await callTool(token, 'listTransactions', {
      month: 9,
      year: 2026,
    });
    expect(after.data.items).toEqual([]);
  });

  it('liga compras avulsas, confere com o extrato, fecha e edita a fatura', async () => {
    const vault = await createVault();
    const token = await connect(vault);
    const statementInvoice = await importCard(vault);
    const [card] = (await callTool(token, 'listCards')).data;

    const tx = await callTool(token, 'addTransaction', {
      amount: 1000,
      type: 'expense',
      date: '2026-08-13',
      description: 'mercado do bairro',
    });
    const dup = await callTool(token, 'listSuspectedDuplicates');
    expect(dup.data).toEqual([
      expect.objectContaining({
        manual: expect.objectContaining({ transactionId: tx.data.id }),
        confidence: 'high',
      }),
    ]);

    const linked = await callTool(token, 'linkTransactionsToInvoice', {
      ids: [tx.data.id, 'nao-existe'],
      invoiceId: statementInvoice,
    });
    expect(linked.data.updated).toEqual([tx.data.id]);
    expect(linked.data.failed).toEqual([
      { id: 'nao-existe', error: 'Transação não encontrada' },
    ]);
    expect(linked.data.invoice.purchasesTotal).toBe(3050);

    const reconcile = await callTool(token, 'reconcileInvoice', {
      invoiceId: statementInvoice,
    });
    expect(reconcile.data.extra).toEqual([
      expect.objectContaining({ transactionId: tx.data.id }),
    ]);
    expect(reconcile.data.duplicates).toHaveLength(1);
    expect(reconcile.data.missing).toEqual([]);

    const unlinked = await callTool(token, 'linkTransactionsToInvoice', {
      ids: [tx.data.id],
      invoiceId: null,
    });
    expect(unlinked.data.updated).toEqual([tx.data.id]);

    // Uma fatura em aberto fechada à mão e com vencimento corrigido.
    const open = await callTool(token, 'addInvoicePayment', {
      cardId: card.id,
      amount: 10,
      date: '2026-09-20',
    });
    const openId = open.data.payment.invoiceId;
    expect(openId).not.toBe(statementInvoice);
    const closed = await callTool(token, 'closeInvoice', {
      invoiceId: openId,
      closingDate: '2026-09-28',
    });
    expect(closed.data).toMatchObject({ closingDate: '2026-09-28' });
    const edited = await callTool(token, 'updateInvoice', {
      invoiceId: openId,
      dueDate: '2026-10-07',
    });
    expect(edited.data.dueDate).toBe('2026-10-07');
    const invalid = await callTool(token, 'updateInvoice', {
      invoiceId: openId,
      dueDate: '2026-09-01',
    });
    expect(invalid.isError).toBe(true);
    const moved = await callTool(token, 'updateInvoicePayment', {
      paymentId: open.data.payment.id,
      amount: 20,
    });
    expect(moved.data.payment.amount).toBe(20);

    const listed = await callTool(token, 'listInvoices', { cardId: card.id });
    expect(listed.data.invoices.map((i: any) => i.id)).toEqual([
      openId,
      statementInvoice,
    ]);
    const preview = await callTool(token, 'previewInvoiceReprocess');
    expect(preview.data).toMatchObject({ statements: [], payments: [] });
  });

  it('um vault não enxerga cartões e faturas de outro', async () => {
    const owner = await createVault();
    const intruder = await createVault();
    const ownerToken = await connect(owner);
    const intruderToken = await connect(intruder);
    const invoiceId = await importCard(owner);
    const [card] = (await callTool(ownerToken, 'listCards')).data;

    expect((await callTool(intruderToken, 'listCards')).data).toEqual([]);
    expect(
      (await callTool(intruderToken, 'getInvoice', { invoiceId })).isError,
    ).toBe(true);
    expect(
      (
        await callTool(intruderToken, 'addInvoicePayment', {
          cardId: card.id,
          amount: 10,
          date: '2026-09-10',
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await callTool(intruderToken, 'updateCard', {
          cardId: card.id,
          name: 'meu',
        })
      ).isError,
    ).toBe(true);
  });
});
