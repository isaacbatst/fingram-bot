/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as schema from '@/shared/persistence/drizzle/schema';
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

type Line = { fitId: string; amount: string; memo: string; date?: string };

/** OFX 1.x SGML em ISO-8859-1, como os bancos brasileiros emitem. */
function ofxBase64(lines: Line[], accountId = '1234567-8'): string {
  const transactions = lines
    .map(
      (line) => `<STMTTRN>
<TRNTYPE>${line.amount.startsWith('-') ? 'DEBIT' : 'CREDIT'}
<DTPOSTED>${line.date ?? '20260115'}000000[-3:BRT]
<TRNAMT>${line.amount}
<FITID>${line.fitId}
<MEMO>${line.memo}
</STMTTRN>`,
    )
    .join('\n');

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
<ACCTID>${accountId}
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101
<DTEND>20260131
${transactions}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>1000.00
<DTASOF>20260131
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

  return Buffer.from(content, 'latin1').toString('base64');
}

describe('Import API (integration)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let vaultToken: string;
  let vaultId: string;
  let boxId: string;

  const auth = (req: request.Test) =>
    req.set('Cookie', `vault_access_token=${vaultToken}`);

  const upload = async (
    lines: Line[],
    accountId?: string,
    fromDate?: string,
  ) => {
    const response = await auth(
      request(app.getHttpServer())
        .post('/vault/import/upload')
        .send({
          contentBase64: ofxBase64(lines, accountId),
          fileName: 'extrato.ofx',
          boxId,
          fromDate,
        }),
    );
    expect(response.status).toBe(201);
    return response.body.batches[0];
  };

  const review = async (batchId: string) => {
    const response = await auth(
      request(app.getHttpServer()).get(`/vault/import/batch/${batchId}`),
    );
    expect(response.status).toBe(200);
    return response.body;
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
  });

  it('should reject an unauthenticated upload', async () => {
    const response = await request(app.getHttpServer())
      .post('/vault/import/upload')
      .send({ contentBase64: ofxBase64([]) });
    expect(response.status).toBe(401);
  });

  it('should stage the statement without creating any transaction', async () => {
    const batch = await upload([
      { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD 1234' },
      { fitId: 'F2', amount: '7500.00', memo: 'SALARIO' },
    ]);

    expect(batch.accountKey).toBe('0260:1234567-8:CHECKING');
    expect(batch.ledgerBalance).toBe(1000);

    const body = await review(batch.id);
    expect(body.counts.pending).toBe(2);
    expect(body.entries.items).toHaveLength(2);

    const transactions = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.vaultId, vaultId));
    expect(transactions).toHaveLength(0);
  });

  it('should preserve latin1 accents through the whole round trip', async () => {
    const batch = await upload([
      { fitId: 'F1', amount: '-1200.00', memo: 'CONDOMÍNIO ÁGUAS & JARDIM' },
    ]);
    const body = await review(batch.id);
    expect(body.entries.items[0].description).toBe(
      'CONDOMÍNIO ÁGUAS & JARDIM',
    );
  });

  it('should be idempotent when the same file is uploaded twice', async () => {
    const lines: Line[] = [
      { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
      { fitId: 'F2', amount: '7500.00', memo: 'SALARIO' },
    ];
    await upload(lines);
    const second = await upload(lines);

    expect(second.duplicateCount).toBe(2);
    const body = await review(second.id);
    expect(body.counts.pending).toBe(0);

    const entries = await db.select().from(schema.importEntry);
    expect(entries).toHaveLength(2);
  });

  it('should bring only the new lines of an overlapping period', async () => {
    await upload([
      { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
      { fitId: 'F2', amount: '7500.00', memo: 'SALARIO' },
    ]);
    const second = await upload([
      { fitId: 'F2', amount: '7500.00', memo: 'SALARIO' },
      { fitId: 'F3', amount: '-12.00', memo: 'PADARIA' },
    ]);

    const body = await review(second.id);
    expect(body.counts.pending).toBe(1);
    expect(body.entries.items[0].fitId).toBe('F3');
    expect(second.duplicateCount).toBe(1);
  });

  it('should accept the same FITID coming from another account', async () => {
    await upload([{ fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' }]);
    const other = await upload(
      [{ fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' }],
      '9999999-0',
    );

    expect(other.duplicateCount).toBe(0);
    const body = await review(other.id);
    expect(body.counts.pending).toBe(1);
  });

  it('should create a committed transaction on confirmation', async () => {
    const batch = await upload([
      { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
    ]);
    const body = await review(batch.id);
    const entryId = body.entries.items[0].id;

    const response = await auth(
      request(app.getHttpServer())
        .post('/vault/import/confirm')
        .send({ entryIds: [entryId] }),
    );
    expect(response.status).toBe(201);
    expect(response.body.confirmed).toBe(1);

    const transactions = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.vaultId, vaultId));
    expect(transactions).toHaveLength(1);
    expect(transactions[0].committed).toBe(true);
    expect(transactions[0].amount).toBe(45.9);
    expect(transactions[0].type).toBe('expense');
    expect(transactions[0].boxId).toBe(boxId);

    const [entry] = await db
      .select()
      .from(schema.importEntry)
      .where(eq(schema.importEntry.id, entryId));
    expect(entry.status).toBe('confirmed');
    expect(entry.transactionId).toBe(transactions[0].id);
  });

  it('should carry an edit into the created transaction', async () => {
    const batch = await upload([
      { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
    ]);
    const body = await review(batch.id);
    const entryId = body.entries.items[0].id;

    const edited = await auth(
      request(app.getHttpServer())
        .post('/vault/import/entry/edit')
        .send({ entryId, amount: 60, description: 'Almoço com cliente' }),
    );
    expect(edited.status).toBe(201);
    // O bruto continua intacto — é a chave de deduplicação.
    expect(edited.body.rawAmount).toBe(-45.9);
    expect(edited.body.rawDescription).toBe('PAG*IFOOD');

    await auth(
      request(app.getHttpServer())
        .post('/vault/import/confirm')
        .send({ entryIds: [entryId] }),
    );

    const transactions = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.vaultId, vaultId));
    expect(transactions[0].amount).toBe(60);
    expect(transactions[0].description).toBe('Almoço com cliente');
  });

  it('should confirm a whole batch at once', async () => {
    const batch = await upload([
      { fitId: 'F1', amount: '-10.00', memo: 'A' },
      { fitId: 'F2', amount: '-20.00', memo: 'B' },
      { fitId: 'F3', amount: '-30.00', memo: 'C' },
    ]);

    const response = await auth(
      request(app.getHttpServer())
        .post('/vault/import/batch/confirm')
        .send({ batchId: batch.id }),
    );
    expect(response.status).toBe(201);
    expect(response.body.confirmed).toBe(3);

    const transactions = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.vaultId, vaultId));
    expect(transactions).toHaveLength(3);
  });

  it('should not resurrect a dismissed line on a re-upload', async () => {
    const lines: Line[] = [{ fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' }];
    const batch = await upload(lines);
    const body = await review(batch.id);
    const entryId = body.entries.items[0].id;

    const dismissed = await auth(
      request(app.getHttpServer())
        .post('/vault/import/entry/dismiss')
        .send({ entryId }),
    );
    expect(dismissed.status).toBe(201);

    const transactions = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.vaultId, vaultId));
    expect(transactions).toHaveLength(0);

    const second = await upload(lines);
    expect(second.duplicateCount).toBe(1);
    const secondBody = await review(second.id);
    expect(secondBody.counts.pending).toBe(0);
  });

  it('should not expose a batch belonging to another vault', async () => {
    const batch = await upload([
      { fitId: 'F1', amount: '-10.00', memo: 'A' },
    ]);
    const other = await createTestVault(db);

    const response = await request(app.getHttpServer())
      .get(`/vault/import/batch/${batch.id}`)
      .set('Cookie', `vault_access_token=${other.token}`);
    expect(response.status).toBe(404);
  });

  it('should honour the optional start date and keep the dropped lines recoverable', async () => {
    const maio: Line[] = [
      { fitId: 'F02', amount: '-10.00', memo: 'DIA 02', date: '20260502' },
      { fitId: 'F06', amount: '-20.00', memo: 'DIA 06', date: '20260506' },
      { fitId: 'F10', amount: '-30.00', memo: 'DIA 10', date: '20260510' },
    ];

    const batch = await upload(maio, undefined, '2026-05-06');
    expect(batch.outOfRangeCount).toBe(1);
    expect(batch.fromDate).toBe('2026-05-06T00:00:00.000Z');

    const body = await review(batch.id);
    expect(body.counts.pending).toBe(2);
    expect(body.outOfRangeCount).toBe(1);
    expect(body.entries.items.map((e: { fitId: string }) => e.fitId)).toEqual([
      'F06',
      'F10',
    ]);

    // A linha cortada nao registrou FITID, entao volta num reimport sem corte.
    const second = await upload(maio);
    const secondBody = await review(second.id);
    expect(secondBody.counts.pending).toBe(1);
    expect(secondBody.entries.items[0].fitId).toBe('F02');
  });

  it('should reject an invalid start date', async () => {
    const response = await auth(
      request(app.getHttpServer())
        .post('/vault/import/upload')
        .send({
          contentBase64: ofxBase64([
            { fitId: 'F1', amount: '-10.00', memo: 'A' },
          ]),
          fromDate: '06/05/2026',
        }),
    );
    expect(response.status).toBe(400);
  });

  it('should group pending lines by establishment and categorise a whole group', async () => {
    const categoryId = crypto.randomUUID();
    await db.insert(schema.vaultCategory).values({
      id: categoryId,
      vaultId,
      name: 'Alimentação',
      code: 'alim',
      transactionType: 'expense',
    });

    const batch = await upload([
      { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD 1234' },
      { fitId: 'F2', amount: '-32.10', memo: 'PAG*IFOOD 5678' },
      { fitId: 'F3', amount: '-12.00', memo: 'PADARIA CENTRAL' },
    ]);

    const grouped = await auth(
      request(app.getHttpServer()).get(`/vault/import/batch/${batch.id}/groups`),
    );
    expect(grouped.status).toBe(200);
    expect(grouped.body.groups).toHaveLength(2);

    const [biggest] = grouped.body.groups;
    expect(biggest.count).toBe(2);
    expect(biggest.description).toContain('IFOOD');

    const categorized = await auth(
      request(app.getHttpServer())
        .post('/vault/import/entries/categorize')
        .send({ entryIds: biggest.entryIds, categoryId }),
    );
    expect(categorized.status).toBe(201);
    expect(categorized.body.updated).toBe(2);

    // Categorizar não confirma: nada virou transação ainda.
    const transactions = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.vaultId, vaultId));
    expect(transactions).toHaveLength(0);

    await auth(
      request(app.getHttpServer())
        .post('/vault/import/confirm')
        .send({ entryIds: biggest.entryIds }),
    );

    const created = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.vaultId, vaultId));
    expect(created).toHaveLength(2);
    expect(created.every((t) => t.categoryId === categoryId)).toBe(true);
  });

  it('should suggest and confirm a planned payment tied to the plan allocation', async () => {
    const hoje = new Date();
    const plano = await auth(
      request(app.getHttpServer())
        .post('/plans')
        .send({
          name: 'Plano',
          startDate: `${hoje.getUTCFullYear()}-01-01`,
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 5000 }],
          },
          allocations: [
            {
              label: 'Financiamento Caixa',
              target: 300000,
              monthlyAmount: [{ month: 0, amount: 2340 }],
              realizationMode: 'immediate',
              scheduledMovements: [],
            },
          ],
        }),
    ).expect(201);
    const allocationId = plano.body.allocations[0].id;

    const dia = `${hoje.getUTCFullYear()}${String(hoje.getUTCMonth() + 1).padStart(2, '0')}05`;
    const batch = await upload([
      { fitId: 'F1', amount: '-2340.00', memo: 'CAIXA FINANCIAMENTO', date: dia },
    ]);

    const grouped = await auth(
      request(app.getHttpServer()).get(`/vault/import/batch/${batch.id}/groups`),
    );
    const [grupo] = grouped.body.groups;
    expect(grupo.suggestedAllocation).toEqual({
      allocationId,
      label: 'Financiamento Caixa',
    });

    await auth(
      request(app.getHttpServer())
        .post('/vault/import/entries/categorize')
        .send({ entryIds: grupo.entryIds, allocationId }),
    ).expect(201);
    await auth(
      request(app.getHttpServer())
        .post('/vault/import/confirm')
        .send({ entryIds: grupo.entryIds }),
    ).expect(201);

    const [transacao] = await db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.vaultId, vaultId));
    expect(transacao.allocationId).toBe(allocationId);
    expect(transacao.categoryId).toBeNull();
  });

  it('should reject a file that is not an OFX', async () => {
    const response = await auth(
      request(app.getHttpServer())
        .post('/vault/import/upload')
        .send({
          contentBase64: Buffer.from('data,valor\n01/01/2026,10').toString(
            'base64',
          ),
        }),
    );
    expect(response.status).toBe(400);
  });
});
