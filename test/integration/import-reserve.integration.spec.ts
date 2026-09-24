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

type Line = { fitId: string; amount: string; memo: string; date: string };

function ofxBase64(lines: Line[]): string {
  const transactions = lines
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
<DTSTART>20200101
<DTEND>20991231
${transactions}
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;
  return Buffer.from(content, 'latin1').toString('base64');
}

/**
 * Saída paga com dinheiro de uma Reserva, confirmada direto na triagem do import
 * (spec-operational.md §9). O plano começa no mês passado para que esse mês seja
 * "real" na projeção.
 */
describe('Import: realização/saque de Reserva (integration)', () => {
  let app: INestApplication;
  let db: NodePgDatabase<typeof schema>;
  let vaultToken: string;
  let vaultId: string;
  let boxId: string;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test) =>
    req.set('Cookie', `vault_access_token=${vaultToken}`);

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

  /**
   * Reserva "Viagem" vinculada a um estrato de reserva com R$ 5.000 aportados,
   * uma alocação de Pagamento e um extrato com uma saída de R$ 1.200 e uma
   * entrada de R$ 300.
   */
  async function seed(
    realizationMode: 'manual' | 'never' = 'manual',
    bind = true,
  ) {
    const hoje = new Date();
    const mesPassado = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1),
    );
    const ymd = (day: number) =>
      `${mesPassado.getUTCFullYear()}-${String(mesPassado.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const reservaBoxId = crypto.randomUUID();
    await db.insert(schema.box).values({
      id: reservaBoxId,
      vaultId,
      name: 'Reserva viagem',
      isDefault: false,
      type: 'saving',
      createdAt: new Date(),
    });

    const plano = await auth(
      http()
        .post('/plans')
        .send({
          name: 'Plano',
          startDate: ymd(1),
          premises: {
            salaryChangePoints: [{ month: 0, amount: 10000 }],
            costOfLivingChangePoints: [{ month: 0, amount: 5000 }],
          },
          allocations: [
            {
              label: 'Viagem',
              target: 10000,
              monthlyAmount: [{ month: 0, amount: 5000 }],
              realizationMode,
              scheduledMovements: [],
            },
            {
              label: 'Financiamento',
              target: 0,
              monthlyAmount: [{ month: 0, amount: 1000 }],
              realizationMode: 'immediate',
              scheduledMovements: [],
            },
          ],
        }),
    ).expect(201);
    const [reserva, pagamento] = plano.body.allocations;
    if (bind) {
      await auth(
        http()
          .patch(`/plans/${plano.body.id}/allocations/${reserva.id}`)
          .send({ estratoId: reservaBoxId }),
      ).expect(200);
    }

    await auth(
      http()
        .post('/vault/create-transfer')
        .send({
          fromBoxId: boxId,
          toBoxId: reservaBoxId,
          amount: 5000,
          date: ymd(2),
        }),
    ).expect(201);

    const upload = await auth(
      http()
        .post('/vault/import/upload')
        .send({
          contentBase64: ofxBase64([
            {
              fitId: 'R1',
              amount: '-1200.00',
              memo: 'CVC VIAGENS',
              date: ymd(20).replace(/-/g, ''),
            },
            {
              fitId: 'R2',
              amount: '300.00',
              memo: 'REEMBOLSO',
              date: ymd(21).replace(/-/g, ''),
            },
          ]),
          fileName: 'extrato.ofx',
          boxId,
        }),
    ).expect(201);
    const entries = await db
      .select()
      .from(schema.importEntry)
      .where(eq(schema.importEntry.batchId, upload.body.batches[0].id));

    return {
      planId: plano.body.id as string,
      reservaId: reserva.id as string,
      pagamentoId: pagamento.id as string,
      reservaBoxId,
      saidaId: entries.find((e) => e.rawMemo === 'CVC VIAGENS')!.id,
      entradaId: entries.find((e) => e.rawMemo === 'REEMBOLSO')!.id,
    };
  }

  const confirmReserve = (body: Record<string, unknown>) =>
    auth(http().post('/vault/import/confirm-reserve-withdrawal').send(body));

  const boxBalance = async (id: string) => {
    const res = await auth(http().get('/vault/boxes')).expect(200);
    return (res.body as { id: string; balance: number }[]).find(
      (b) => b.id === id,
    )!.balance;
  };

  const transactions = () =>
    db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.vaultId, vaultId));

  it('lança a realização no estrato da Reserva, como o formulário', async () => {
    const s = await seed();

    const res = await confirmReserve({
      entryIds: [s.saidaId, s.entradaId],
      allocationId: s.reservaId,
      withdrawalType: 'realization',
    }).expect(201);
    // A linha de receita não é saída de Reserva.
    expect(res.body).toEqual({ confirmed: 1, skipped: [s.entradaId] });

    const txs = await transactions();
    const despesa = txs.find((t) => t.allocationId === s.reservaId)!;
    expect(despesa).toMatchObject({
      amount: 1200,
      type: 'expense',
      boxId: s.reservaBoxId,
      withdrawalType: 'realization',
      categoryId: null,
      committed: true,
    });
    // Nenhuma transferência além do aporte: nada que pareça aporte ou receita.
    expect(txs.filter((t) => t.transferId)).toHaveLength(2);
    expect(txs.filter((t) => t.amount === 1200)).toHaveLength(1);

    // Reserva: 5000 aportados − 1200 realizados. Corrente: só o aporte saiu.
    expect(await boxBalance(s.reservaBoxId)).toBe(3800);
    expect(await boxBalance(boxId)).toBe(-5000);

    const [entry] = await db
      .select()
      .from(schema.importEntry)
      .where(eq(schema.importEntry.id, s.saidaId));
    expect(entry).toMatchObject({
      status: 'confirmed',
      transactionId: despesa.id,
      allocationId: s.reservaId,
      boxId: s.reservaBoxId,
    });

    // Plano: aporte do mês 5000, sem receita, e a Reserva fecha em 3800.
    const proj = await auth(
      http().get(`/plans/${s.planId}/projection?months=2`),
    ).expect(200);
    const [mes] = proj.body;
    expect(mes.isReal).toBe(true);
    expect(mes.allocationPayments[s.reservaId]).toBe(5000);
    expect(mes.income).toBe(0);
    expect(mes.costOfLiving).toBe(0);
    expect(mes.allocations[s.reservaId]).toBe(3800);

    // Visão do dia a dia do mês: a realização não aparece como receita.
    const hoje = new Date();
    const mesPassado = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1),
    );
    const summary = await auth(
      http().get(
        `/vault/summary?year=${mesPassado.getUTCFullYear()}&month=${mesPassado.getUTCMonth() + 1}`,
      ),
    ).expect(200);
    expect(summary.body.vault.totalIncomeAmount).toBe(0);
  });

  it('mantém a despesa na conta quando fromEstrato é false', async () => {
    const s = await seed();
    await confirmReserve({
      entryIds: [s.saidaId],
      allocationId: s.reservaId,
      withdrawalType: 'withdrawal',
      fromEstrato: false,
    }).expect(201);

    const doValor = (await transactions()).filter((t) => t.amount === 1200);
    expect(doValor).toHaveLength(1);
    expect(doValor[0]).toMatchObject({
      boxId,
      withdrawalType: 'withdrawal',
    });
    expect(await boxBalance(s.reservaBoxId)).toBe(5000);
  });

  it('recusa alocação de Pagamento e withdrawalType inválido', async () => {
    const s = await seed();
    const pagamento = await confirmReserve({
      entryIds: [s.saidaId],
      allocationId: s.pagamentoId,
      withdrawalType: 'realization',
    }).expect(400);
    expect(pagamento.body.message).toMatch(/Reserva/);

    await confirmReserve({
      entryIds: [s.saidaId],
      allocationId: s.reservaId,
      withdrawalType: 'outro',
    }).expect(400);

    expect(await transactions()).toHaveLength(2); // só o aporte
  });

  it('recusa realização em Reserva que não permite realizar', async () => {
    const s = await seed('never');
    const res = await confirmReserve({
      entryIds: [s.saidaId],
      allocationId: s.reservaId,
      withdrawalType: 'realization',
    }).expect(400);
    expect(res.body.message).toMatch(/só saque/);
  });

  it('recusa mover dinheiro de Reserva sem estrato vinculado', async () => {
    const s = await seed('manual', false);
    const res = await confirmReserve({
      entryIds: [s.saidaId],
      allocationId: s.reservaId,
      withdrawalType: 'realization',
    }).expect(400);
    expect(res.body.message).toMatch(/estrato vinculado/);

    const [entry] = await db
      .select()
      .from(schema.importEntry)
      .where(eq(schema.importEntry.id, s.saidaId));
    expect(entry.status).toBe('pending');
  });
});
