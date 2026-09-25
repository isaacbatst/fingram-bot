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
<DTSTART>20260901
<DTEND>20260930
${stmttrn(lines)}
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`,
    'latin1',
  ).toString('base64');
}

function cardOfx(lines: Line[], ledgerBalance: string | null): string {
  const balance =
    ledgerBalance === null
      ? ''
      : `<LEDGERBAL><BALAMT>${ledgerBalance}<DTASOF>20260902</LEDGERBAL>`;
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

const PAYMENT: Line = {
  fitId: 'P1',
  amount: '-3200.00',
  memo: 'PAGAMENTO FATURA',
  date: '20260910',
};
const PURCHASES: Line[] = [
  { fitId: 'C1', amount: '-1000.00', memo: 'MERCADO BOM', date: '20260812' },
  { fitId: 'C2', amount: '-1050.00', memo: 'POSTO SHELL', date: '20260820' },
];
const REDIRECT_URI = 'http://localhost:9999/callback';

/**
 * Tools MCP de fatura de cartão. A fatura nasce do pagamento importado da conta
 * corrente; as compras vêm do extrato do cartão (ver card-invoice.integration).
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

  async function registerInvoice(vault: Vault): Promise<string> {
    const batch = await upload(vault, checkingOfx([PAYMENT]));
    const groups = await http()
      .get(`/vault/import/batch/${batch.id}/groups`)
      .set('Cookie', `vault_access_token=${vault.token}`);
    const res = await post(vault, '/vault/import/confirm-invoice', {
      entryIds: groups.body.groups[0].entryIds,
    }).expect(201);
    return res.body.invoiceIds[0];
  }

  /** Importa e confirma as compras do cartão. Com LEDGERBAL = pago, liga sozinho. */
  async function importCard(vault: Vault, ledgerBalance: string | null) {
    const batch = await upload(vault, cardOfx(PURCHASES, ledgerBalance));
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
    return batch.id;
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

  it('lista e detalha a fatura conforme as compras são ligadas', async () => {
    const vault = await createVault();
    const token = await connect(vault);
    const invoiceId = await registerInvoice(vault);

    const before = await callTool(token, 'listInvoices');
    expect(before.data.invoices).toEqual([
      expect.objectContaining({
        id: invoiceId,
        amount: 3200,
        paymentDate: '2026-09-10',
        estratoId: vault.boxId,
        status: 'awaiting',
        itemized: 0,
        remainder: 3200,
        excess: 0,
        purchaseCount: 0,
        statements: [],
      }),
    ]);

    const statementId = await importCard(vault, '-3200.00');

    const after = await callTool(token, 'listInvoices');
    expect(after.data.invoices[0]).toMatchObject({
      status: 'partial',
      itemized: 2050,
      remainder: 1150,
      purchaseCount: 2,
      statements: [expect.objectContaining({ statementId })],
    });
    expect(after.data.unlinkedStatements).toEqual([]);

    const detail = await callTool(token, 'getInvoice', { invoiceId });
    expect(detail.data.remainder).toBe(1150);
    expect(detail.data.remainderTransactionId).toEqual(expect.any(String));
    expect(detail.data.purchases).toEqual([
      expect.objectContaining({
        purchaseDate: '2026-08-12',
        amount: 1000,
        description: 'MERCADO BOM',
        category: { id: vault.categoryId, name: 'Mercado' },
      }),
      expect.objectContaining({ purchaseDate: '2026-08-20', amount: 1050 }),
    ]);

    // As compras contam na data do pagamento, com a data da compra à parte.
    const listed = await callTool(token, 'listTransactions', {
      month: 9,
      year: 2026,
    });
    const items = listed.data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items.find((t) => t.invoiceRole === 'remainder')).toMatchObject({
      id: detail.data.remainderTransactionId,
      amount: 1150,
      date: '2026-09-10',
      invoiceId,
      purchaseDate: null,
    });
    expect(
      items
        .filter((t) => t.invoiceRole === 'purchase')
        .map((t) => [t.date, t.purchaseDate, t.invoiceId]),
    ).toEqual(
      expect.arrayContaining([
        ['2026-09-10', '2026-08-12', invoiceId],
        ['2026-09-10', '2026-08-20', invoiceId],
      ]),
    );
  });

  it('não deixa editar, categorizar ou remover o não discriminado por fora da fatura', async () => {
    const vault = await createVault();
    const token = await connect(vault);
    const invoiceId = await registerInvoice(vault);
    const detail = await callTool(token, 'getInvoice', { invoiceId });
    const remainderId = detail.data.remainderTransactionId as string;

    const del = await callTool(token, 'deleteTransaction', { id: remainderId });
    expect(del.isError).toBe(true);
    expect(del.text).toMatch(/deleteInvoice/);

    const edit = await callTool(token, 'editTransaction', {
      id: remainderId,
      amount: 10,
    });
    expect(edit.isError).toBe(true);
    expect(edit.text).toMatch(/deleteInvoice/);

    const categorize = await callTool(token, 'categorizeTransactions', {
      ids: [remainderId],
      categoryId: vault.categoryId,
    });
    expect(categorize.isError).toBe(true);

    const still = await callTool(token, 'listInvoices');
    expect(still.data.invoices[0]).toMatchObject({
      id: invoiceId,
      remainder: 3200,
    });
  });

  it('liga e desliga manualmente um extrato que não casou sozinho', async () => {
    const vault = await createVault();
    const token = await connect(vault);
    const invoiceId = await registerInvoice(vault);
    // Sem LEDGERBAL e com compras que não somam o pago: não liga sozinho.
    const statementId = await importCard(vault, null);

    const unlinked = await callTool(token, 'listInvoices');
    expect(unlinked.data.invoices[0].status).toBe('awaiting');
    expect(unlinked.data.unlinkedStatements).toEqual([
      expect.objectContaining({ statementId, purchaseCount: 2, total: 2050 }),
    ]);

    const linked = await callTool(token, 'linkStatementToInvoice', {
      statementId,
      invoiceId,
    });
    expect(linked.isError).toBe(false);
    expect(linked.data.invoice).toMatchObject({
      id: invoiceId,
      status: 'partial',
      remainder: 1150,
    });

    const unlink = await callTool(token, 'linkStatementToInvoice', {
      statementId,
      invoiceId: null,
    });
    expect(unlink.data.invoice).toBeNull();
    const back = await callTool(token, 'listInvoices');
    expect(back.data.invoices[0]).toMatchObject({
      status: 'awaiting',
      remainder: 3200,
    });
    expect(back.data.unlinkedStatements).toHaveLength(1);

    // Desligadas, as compras voltam às datas em que foram feitas.
    const august = await callTool(token, 'listTransactions', {
      month: 8,
      year: 2026,
    });
    expect(august.data.total).toBe(2);
  });

  it('exclui a fatura e devolve as compras às datas delas', async () => {
    const vault = await createVault();
    const token = await connect(vault);
    const invoiceId = await registerInvoice(vault);
    await importCard(vault, '-3200.00');

    const deleted = await callTool(token, 'deleteInvoice', { invoiceId });
    expect(deleted.data).toEqual({ deleted: invoiceId });

    expect((await callTool(token, 'listInvoices')).data.invoices).toEqual([]);
    expect((await callTool(token, 'getInvoice', { invoiceId })).isError).toBe(
      true,
    );

    const september = await callTool(token, 'listTransactions', {
      month: 9,
      year: 2026,
    });
    expect(september.data.total).toBe(0);
    const august = await callTool(token, 'listTransactions', {
      month: 8,
      year: 2026,
    });
    expect(
      (august.data.items as Array<Record<string, unknown>>).map((t) => [
        t.date,
        t.invoiceRole,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['2026-08-12', null],
        ['2026-08-20', null],
      ]),
    );
  });

  describe('createInvoice', () => {
    const septemberSpent = async (token: string) =>
      (await callTool(token, 'getBudgetSummary', { month: 9, year: 2026 })).data
        .spent as number;

    it('cria a fatura antes do débito e o débito importado vira o pagamento dela, sem duplicar', async () => {
      const vault = await createVault();
      const token = await connect(vault);

      const created = await callTool(token, 'createInvoice', {
        amount: 3200,
        paymentDate: '2026-09-08',
        cardLabel: 'Nubank',
      });
      expect(created.isError).toBe(false);
      expect(created.data).toMatchObject({
        amount: 3200,
        paymentDate: '2026-09-08',
        estratoId: vault.boxId,
        cardLabel: 'Nubank',
        paymentImported: false,
        status: 'awaiting',
        remainder: 3200,
      });
      expect(await septemberSpent(token)).toBe(3200);

      // O extrato da conta traz o débito dois dias depois.
      const invoiceId = await registerInvoice(vault);
      expect(invoiceId).toBe(created.data.id);

      const listed = await callTool(token, 'listInvoices');
      expect(listed.data.invoices).toHaveLength(1);
      expect(listed.data.invoices[0]).toMatchObject({
        id: created.data.id,
        paymentImported: true,
        paymentDate: '2026-09-10',
        remainder: 3200,
      });
      expect(await septemberSpent(token)).toBe(3200);

      const remainders = (
        await callTool(token, 'listTransactions', { month: 9, year: 2026 })
      ).data.items.filter(
        (t: { invoiceRole: string }) => t.invoiceRole === 'remainder',
      );
      expect(remainders).toHaveLength(1);
      expect(remainders[0].date).toBe('2026-09-10');
    });

    it('liga na hora um extrato de cartão pendente que bate com ela', async () => {
      const vault = await createVault();
      const token = await connect(vault);
      const statementId = await importCard(vault, '-3200.00');

      const created = await callTool(token, 'createInvoice', {
        amount: 3200,
        paymentDate: '2026-09-10',
      });
      expect(created.data).toMatchObject({
        status: 'partial',
        remainder: 1150,
        statements: [expect.objectContaining({ statementId })],
      });
      expect(await septemberSpent(token)).toBe(3200);
    });

    it('recusa o que parece a mesma fatura, a menos que allowDuplicate confirme', async () => {
      const vault = await createVault();
      const token = await connect(vault);
      await registerInvoice(vault); // 3200 em 10/09, vinda do import

      const dup = await callTool(token, 'createInvoice', {
        amount: 3200,
        paymentDate: '2026-09-12',
      });
      expect(dup.isError).toBe(true);
      expect(dup.text).toMatch(/allowDuplicate/);
      expect(
        (await callTool(token, 'listInvoices')).data.invoices,
      ).toHaveLength(1);

      const forced = await callTool(token, 'createInvoice', {
        amount: 3200,
        paymentDate: '2026-09-12',
        allowDuplicate: true,
      });
      expect(forced.isError).toBe(false);
      expect(
        (await callTool(token, 'listInvoices')).data.invoices,
      ).toHaveLength(2);
    });

    it('não aceita estrato de outro vault', async () => {
      const mine = await createVault();
      const other = await createVault();
      const token = await connect(mine);
      const res = await callTool(token, 'createInvoice', {
        amount: 100,
        paymentDate: '2026-09-10',
        estratoId: other.boxId,
      });
      expect(res.isError).toBe(true);
      expect((await callTool(token, 'listInvoices')).data.invoices).toEqual([]);
    });
  });

  it('não enxerga nem altera faturas de outro vault', async () => {
    const mine = await createVault();
    const other = await createVault();
    const invoiceId = await registerInvoice(mine);
    const statementId = await importCard(mine, null);
    const otherToken = await connect(other);

    expect((await callTool(otherToken, 'listInvoices')).data.invoices).toEqual(
      [],
    );
    expect(
      (await callTool(otherToken, 'getInvoice', { invoiceId })).isError,
    ).toBe(true);
    expect(
      (
        await callTool(otherToken, 'linkStatementToInvoice', {
          statementId,
          invoiceId,
        })
      ).isError,
    ).toBe(true);
    expect(
      (await callTool(otherToken, 'deleteInvoice', { invoiceId })).isError,
    ).toBe(true);

    const myToken = await connect(mine);
    const still = await callTool(myToken, 'listInvoices');
    expect(still.data.invoices[0]).toMatchObject({
      id: invoiceId,
      status: 'awaiting',
    });
    expect(still.data.unlinkedStatements).toHaveLength(1);
  });
});
