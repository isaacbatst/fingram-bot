import { describe, it, expect, beforeEach } from 'vitest';
import { ImportService } from './import.service';
import { CardInvoiceService } from './card-invoice.service';
import { Vault } from './domain/vault';
import { Box } from './domain/box';
import { InMemoryStore } from '@/shared/persistence/in-memory/in-memory-store';
import { VaultInMemoryRepository } from './repositories/in-memory/vault-in-memory.repository';
import { BoxInMemoryRepository } from './repositories/in-memory/box-in-memory.repository';
import { ImportBatchInMemoryRepository } from './repositories/in-memory/import-batch-in-memory.repository';
import { ImportEntryInMemoryRepository } from './repositories/in-memory/import-entry-in-memory.repository';

type Line = { fitId: string; amount: string; memo: string; date?: string };

/** Monta um OFX 1.x mínimo, no formato SGML que os bancos brasileiros emitem. */
function ofxFile(lines: Line[], accountId = '1234567-8'): Buffer {
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

  return Buffer.from(
    `OFXHEADER:100
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
</OFX>`,
    'latin1',
  );
}

/** Fatura de cartão: CCSTMTRS, como o Nubank emite. */
function ofxCartao(lines: Line[]): Buffer {
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

  return Buffer.from(
    `OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX>
<CREDITCARDMSGSRSV1>
<CCSTMTRS>
<CURDEF>BRL
<CCACCTFROM>
<ACCTID>5c9e7de7-cartao
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101
<DTEND>20260131
${transactions}
</BANKTRANLIST>
</CCSTMTRS>
</CREDITCARDMSGSRSV1>
</OFX>`,
    'utf8',
  );
}

import { PlanQueryService } from '@/plan/shared/plan-query.service';
import { PlanInMemoryRepository } from '@/plan/repositories/in-memory/plan-in-memory.repository';
import { AllocationInMemoryRepository } from '@/plan/shared/repositories/in-memory/allocation-in-memory.repository';
import { Plan } from '@/plan/domain/plan';
import { Allocation } from '@/plan/shared/domain/allocation';

describe('ImportService', () => {
  let service: ImportService;
  let store: InMemoryStore;
  let vaultRepo: VaultInMemoryRepository;
  let entryRepo: ImportEntryInMemoryRepository;
  let invoiceService: CardInvoiceService;
  let vault: Vault;
  let box: Box;
  let reserva: Box;
  let planRepo: PlanInMemoryRepository;
  let allocationRepo: AllocationInMemoryRepository;

  beforeEach(async () => {
    store = new InMemoryStore();
    vaultRepo = new VaultInMemoryRepository(store);
    const boxRepo = new BoxInMemoryRepository();
    const batchRepo = new ImportBatchInMemoryRepository();
    entryRepo = new ImportEntryInMemoryRepository();

    vault = new Vault();
    await vaultRepo.create(vault);
    box = Box.create({ vaultId: vault.id, name: 'Nubank', isDefault: true });
    reserva = Box.create({
      vaultId: vault.id,
      name: 'Reserva',
      type: 'saving',
    });
    await boxRepo.create(box);
    await boxRepo.create(reserva);
    // O agregado também precisa conhecer os estratos: é contra ele que
    // `createTransfer` valida origem e destino (o repositório drizzle os hidrata).
    vault.addBox(box);
    vault.addBox(reserva);

    planRepo = new PlanInMemoryRepository();
    allocationRepo = new AllocationInMemoryRepository();
    service = new ImportService(
      vaultRepo,
      boxRepo,
      batchRepo,
      entryRepo,
      new PlanQueryService(planRepo, allocationRepo),
      (invoiceService = new CardInvoiceService(
        vaultRepo,
        batchRepo,
        entryRepo,
      )),
    );
  });

  /** Plano ativo com uma alocação de Pagamento de parcela mensal fixa. */
  const criarFinanciamento = async (parcela = 2340, vaultId = vault.id) => {
    const plan = Plan.create({
      vaultId,
      name: 'Plano',
      startDate: new Date(Date.UTC(2026, 0, 1)),
      premises: {
        salaryChangePoints: [{ month: 0, amount: 10000 }],
        costOfLivingChangePoints: [{ month: 0, amount: 5000 }],
      },
    });
    await planRepo.create(plan);
    const allocation = Allocation.create({
      planId: plan.id,
      label: 'Financiamento Caixa',
      target: 300000,
      monthlyAmount: [{ month: 0, amount: parcela }],
      realizationMode: 'immediate',
      scheduledMovements: [],
    });
    await allocationRepo.create(allocation);
    return allocation;
  };

  const ingest = async (lines: Line[], accountId?: string, fromDate?: Date) => {
    const [error, batches] = await service.ingest({
      vaultId: vault.id,
      file: ofxFile(lines, accountId),
      fileName: 'extrato.ofx',
      boxId: box.id,
      fromDate,
    });
    expect(error).toBeNull();
    return batches!;
  };

  /** Meia-noite UTC do dia, como o corte é interpretado. */
  const day = (year: number, month: number, dayOfMonth: number) =>
    new Date(Date.UTC(year, month - 1, dayOfMonth));

  const pendingIds = async (batchId: string) =>
    (await entryRepo.findPendingByBatchId(batchId)).map((e) => e.id);

  describe('ingestão', () => {
    it('should stage every line as pending without creating transactions', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
        { fitId: 'F2', amount: '7500.00', memo: 'SALARIO' },
      ]);

      const counts = await entryRepo.countByStatus(batch.id);
      expect(counts.pending).toBe(2);

      const stored = await vaultRepo.findById(vault.id);
      expect(stored!.transactions.size).toBe(0);
    });

    it('should not move the balance while entries are pending', async () => {
      await ingest([{ fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' }]);
      const stored = await vaultRepo.findById(vault.id);
      expect(stored!.getBalance()).toBe(0);
    });

    it('should read the statement metadata used by the review summary', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
      ]);
      expect(batch.accountKey).toBe('0260:1234567-8:CHECKING');
      expect(batch.ledgerBalance).toBe(1000);
      expect(batch.boxId).toBe(box.id);
      expect(batch.periodEnd!.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    });

    it('should reject a file that is not an OFX', async () => {
      const [error] = await service.ingest({
        vaultId: vault.id,
        file: Buffer.from('data,valor\n01/01/2026,10', 'utf8'),
      });
      expect(error).not.toBeNull();
    });
  });

  describe('deduplicação', () => {
    it('should bring nothing new when the same file is imported twice', async () => {
      const lines: Line[] = [
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
        { fitId: 'F2', amount: '7500.00', memo: 'SALARIO' },
      ];
      await ingest(lines);
      const [second] = await ingest(lines);

      const counts = await entryRepo.countByStatus(second.id);
      expect(counts.pending).toBe(0);
      expect(second.duplicateCount).toBe(2);
    });

    it('should bring only the new lines of an overlapping period', async () => {
      await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
        { fitId: 'F2', amount: '7500.00', memo: 'SALARIO' },
      ]);
      const [second] = await ingest([
        { fitId: 'F2', amount: '7500.00', memo: 'SALARIO' },
        { fitId: 'F3', amount: '-12.00', memo: 'PADARIA' },
      ]);

      const pending = await entryRepo.findPendingByBatchId(second.id);
      expect(pending).toHaveLength(1);
      expect(pending[0].fitId).toBe('F3');
      expect(second.duplicateCount).toBe(1);
    });

    it('should not treat the same FITID on another account as a duplicate', async () => {
      await ingest([{ fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' }]);
      const [other] = await ingest(
        [{ fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' }],
        '9999999-0',
      );

      const pending = await entryRepo.findPendingByBatchId(other.id);
      expect(pending).toHaveLength(1);
      expect(other.duplicateCount).toBe(0);
    });
  });

  describe('data inicial opcional', () => {
    const maio: Line[] = [
      { fitId: 'F02', amount: '-10.00', memo: 'DIA 02', date: '20260502' },
      { fitId: 'F06', amount: '-20.00', memo: 'DIA 06', date: '20260506' },
      { fitId: 'F10', amount: '-30.00', memo: 'DIA 10', date: '20260510' },
    ];

    it('should import the whole file when no cutoff is given', async () => {
      const [batch] = await ingest(maio);
      expect(await entryRepo.findPendingByBatchId(batch.id)).toHaveLength(3);
      expect(batch.outOfRangeCount).toBe(0);
      expect(batch.fromDate).toBeNull();
    });

    it('should drop the lines before the cutoff', async () => {
      const [batch] = await ingest(maio, undefined, day(2026, 5, 6));
      const pending = await entryRepo.findPendingByBatchId(batch.id);
      expect(pending.map((e) => e.fitId)).toEqual(['F06', 'F10']);
    });

    it('should include a line falling exactly on the cutoff', async () => {
      const [batch] = await ingest(maio, undefined, day(2026, 5, 6));
      const pending = await entryRepo.findPendingByBatchId(batch.id);
      expect(pending.map((e) => e.fitId)).toContain('F06');
    });

    it('should record the cutoff and how many lines it dropped', async () => {
      const [batch] = await ingest(maio, undefined, day(2026, 5, 6));
      expect(batch.outOfRangeCount).toBe(1);
      expect(batch.fromDate!.toISOString()).toBe('2026-05-06T00:00:00.000Z');
    });

    it('should not count the dropped lines as duplicates', async () => {
      const [batch] = await ingest(maio, undefined, day(2026, 5, 6));
      expect(batch.duplicateCount).toBe(0);
    });

    it('should bring a dropped line back when re-imported without a cutoff', async () => {
      // O corte é uma escolha do momento, não um descarte permanente: a linha
      // fora do período não registra FITID, então continua disponível depois.
      await ingest(maio, undefined, day(2026, 5, 6));
      const [second] = await ingest(maio);

      const pending = await entryRepo.findPendingByBatchId(second.id);
      expect(pending.map((e) => e.fitId)).toEqual(['F02']);
      expect(second.duplicateCount).toBe(2);
    });

    it('should still dedup the lines that were inside the cutoff', async () => {
      await ingest(maio, undefined, day(2026, 5, 6));
      const [second] = await ingest(maio, undefined, day(2026, 5, 6));
      expect(await entryRepo.findPendingByBatchId(second.id)).toHaveLength(0);
      expect(second.duplicateCount).toBe(2);
    });
  });

  describe('agrupamento por estabelecimento', () => {
    const groupsOf = async (batchId: string) => {
      const [error, groups] = await service.getGroups({
        vaultId: vault.id,
        batchId,
      });
      expect(error).toBeNull();
      return groups!;
    };

    it('should collapse repeated purchases at the same establishment', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD 1234' },
        { fitId: 'F2', amount: '-32.10', memo: 'PAG*IFOOD 5678' },
        { fitId: 'F3', amount: '-19.00', memo: 'PAG*IFOOD 9012' },
      ]);

      const groups = await groupsOf(batch.id);
      expect(groups).toHaveLength(1);
      expect(groups[0].count).toBe(3);
      expect(groups[0].entryIds).toHaveLength(3);
    });

    it('should keep different establishments apart', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD 1234' },
        { fitId: 'F2', amount: '-12.00', memo: 'PADARIA CENTRAL' },
      ]);
      expect(await groupsOf(batch.id)).toHaveLength(2);
    });

    it('should never mix income and expense in one group', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-100.00', memo: 'TRANSFERENCIA JOAO' },
        { fitId: 'F2', amount: '100.00', memo: 'TRANSFERENCIA JOAO' },
      ]);

      const groups = await groupsOf(batch.id);
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.type).sort()).toEqual(['expense', 'income']);
    });

    it('should put the biggest group first', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-10.00', memo: 'PADARIA CENTRAL' },
        { fitId: 'F2', amount: '-45.90', memo: 'PAG*IFOOD 1234' },
        { fitId: 'F3', amount: '-32.10', memo: 'PAG*IFOOD 5678' },
      ]);

      const groups = await groupsOf(batch.id);
      expect(groups[0].count).toBe(2);
      expect(groups[0].description).toContain('IFOOD');
    });

    it('should report the total and the date range of the group', async () => {
      const [batch] = await ingest([
        {
          fitId: 'F1',
          amount: '-45.90',
          memo: 'PAG*IFOOD 1234',
          date: '20260105',
        },
        {
          fitId: 'F2',
          amount: '-32.10',
          memo: 'PAG*IFOOD 5678',
          date: '20260120',
        },
      ]);

      const [group] = await groupsOf(batch.id);
      expect(group.totalAmount).toBeCloseTo(78, 2);
      expect(group.firstDate.toISOString()).toBe('2026-01-05T00:00:00.000Z');
      expect(group.lastDate.toISOString()).toBe('2026-01-20T00:00:00.000Z');
    });

    it('should leave a group once its entries are no longer pending', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD 1234' },
        { fitId: 'F2', amount: '-12.00', memo: 'PADARIA CENTRAL' },
      ]);
      const groups = await groupsOf(batch.id);
      const ifood = groups.find((g) => g.description.includes('IFOOD'))!;

      await service.confirmEntries({
        vaultId: vault.id,
        entryIds: ifood.entryIds,
      });

      const after = await groupsOf(batch.id);
      expect(after).toHaveLength(1);
      expect(after[0].description).toContain('PADARIA');
    });
  });

  describe('quitação de fatura', () => {
    const groupsOf = async (batchId: string) => {
      const [, groups] = await service.getGroups({
        vaultId: vault.id,
        batchId,
      });
      return groups!;
    };

    it('should flag the bill payment seen from the checking account', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-3847.00', memo: 'PAGAMENTO FATURA CARTAO' },
        { fitId: 'F2', amount: '-45.90', memo: 'PADARIA CENTRAL' },
      ]);

      const groups = await groupsOf(batch.id);
      const fatura = groups.find((g) => g.description.includes('FATURA'))!;
      const padaria = groups.find((g) => g.description.includes('PADARIA'))!;
      expect(fatura.looksLikeSettlement).toBe(true);
      expect(fatura.suggestsInvoice).toBe(true);
      expect(padaria.looksLikeSettlement).toBe(false);
      expect(padaria.suggestsInvoice).toBe(false);
    });

    it('should dismiss the bill payment seen from inside the card statement', async () => {
      const [error, batches] = await service.ingest({
        vaultId: vault.id,
        file: ofxCartao([
          { fitId: 'C1', amount: '7133.47', memo: 'Pagamento recebido' },
          { fitId: 'C2', amount: '-45.90', memo: 'Ifd*Ifood Club' },
        ]),
        boxId: box.id,
      });
      expect(error).toBeNull();
      expect(batches![0].kind).toBe('creditcard');

      // Esses R$ 7.133,47 são a quitação da fatura, não receita: ficam
      // ignorados desde a leitura e nem chegam à triagem.
      const groups = await groupsOf(batches![0].id);
      expect(groups).toHaveLength(1);
      expect(groups[0].description).toContain('Ifood');
      expect(groups[0].looksLikeSettlement).toBe(false);
      expect(groups[0].suggestsInvoice).toBe(false);

      const [, review] = await service.getReview({
        vaultId: vault.id,
        batchId: batches![0].id,
      });
      expect(review!.counts).toEqual({
        pending: 1,
        confirmed: 0,
        dismissed: 1,
      });
    });

    it('should keep accents from a UTF-8 card statement', async () => {
      const [, batches] = await service.ingest({
        vaultId: vault.id,
        file: ofxCartao([
          { fitId: 'C1', amount: '-45.90', memo: 'Pix no Crédito - São Paulo' },
        ]),
        boxId: box.id,
      });

      const groups = await groupsOf(batches![0].id);
      expect(groups[0].description).toBe('Pix no Crédito - São Paulo');
    });
  });

  describe('pagamento planejado', () => {
    const groupsOf = async (batchId: string) => {
      const [, groups] = await service.getGroups({
        vaultId: vault.id,
        batchId,
      });
      return groups!;
    };

    it('should suggest the payment whose installment matches the line', async () => {
      const financiamento = await criarFinanciamento(2340);
      const [batch] = await ingest([
        {
          fitId: 'F1',
          amount: '-2340.00',
          memo: 'CAIXA FINANCIAMENTO',
          date: '20260305',
        },
        {
          fitId: 'F2',
          amount: '-45.90',
          memo: 'PADARIA CENTRAL',
          date: '20260305',
        },
      ]);

      const groups = await groupsOf(batch.id);
      const caixa = groups.find((g) => g.description.includes('CAIXA'))!;
      const padaria = groups.find((g) => g.description.includes('PADARIA'))!;
      expect(caixa.suggestedAllocation).toEqual({
        allocationId: financiamento.id,
        label: 'Financiamento Caixa',
      });
      expect(padaria.suggestedAllocation).toBeNull();
    });

    it('should not suggest anything when there is no plan', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-2340.00', memo: 'CAIXA FINANCIAMENTO' },
      ]);
      const [group] = await groupsOf(batch.id);
      expect(group.suggestedAllocation).toBeNull();
    });

    it('should not suggest a payment for income', async () => {
      await criarFinanciamento(2340);
      const [batch] = await ingest([
        { fitId: 'F1', amount: '2340.00', memo: 'ESTORNO', date: '20260305' },
      ]);
      const [group] = await groupsOf(batch.id);
      expect(group.suggestedAllocation).toBeNull();
    });

    it('should confirm into a transaction tied to the allocation and with no category', async () => {
      const financiamento = await criarFinanciamento(2340);
      const [batch] = await ingest([
        {
          fitId: 'F1',
          amount: '-2340.00',
          memo: 'CAIXA FINANCIAMENTO',
          date: '20260305',
        },
      ]);
      const ids = await pendingIds(batch.id);

      const [error, result] = await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: ids,
        allocationId: financiamento.id,
      });
      expect(error).toBeNull();
      expect(result!.updated).toBe(1);

      await service.confirmEntries({ vaultId: vault.id, entryIds: ids });
      const stored = await vaultRepo.findById(vault.id);
      const [transaction] = [...stored!.transactions.values()];
      expect(transaction.allocationId).toBe(financiamento.id);
      expect(transaction.categoryId).toBeNull();
    });

    it('should drop the category when a payment is chosen, and vice versa', async () => {
      const financiamento = await criarFinanciamento();
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-2340.00', memo: 'CAIXA FINANCIAMENTO' },
      ]);
      const ids = await pendingIds(batch.id);

      await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: ids,
        categoryId: 'cat-1',
      });
      await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: ids,
        allocationId: financiamento.id,
      });
      let [entry] = await entryRepo.findPendingByBatchId(batch.id);
      expect(entry.allocationId).toBe(financiamento.id);
      expect(entry.categoryId).toBeNull();

      await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: ids,
        categoryId: 'cat-1',
      });
      [entry] = await entryRepo.findPendingByBatchId(batch.id);
      expect(entry.categoryId).toBe('cat-1');
      expect(entry.allocationId).toBeNull();
    });

    it('should refuse a Reserva allocation', async () => {
      const reservaAlloc = Allocation.create({
        planId: (await criarFinanciamento()).planId,
        label: 'Emergência',
        target: 20000,
        monthlyAmount: [{ month: 0, amount: 500 }],
        realizationMode: 'manual',
        scheduledMovements: [],
      });
      await allocationRepo.create(reservaAlloc);
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-500.00', memo: 'X' },
      ]);

      const [error] = await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
        allocationId: reservaAlloc.id,
      });
      expect(error).not.toBeNull();
    });

    it('should refuse an allocation from another vault', async () => {
      const alheia = await criarFinanciamento(2340, 'outro-vault');
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-2340.00', memo: 'X' },
      ]);

      const [error] = await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
        allocationId: alheia.id,
      });
      expect(error).not.toBeNull();
    });

    it('should refuse category and payment at the same time', async () => {
      const financiamento = await criarFinanciamento();
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-2340.00', memo: 'X' },
      ]);
      const [error] = await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
        categoryId: 'cat-1',
        allocationId: financiamento.id,
      });
      expect(error).not.toBeNull();
    });
  });

  describe('categorização em lote', () => {
    it('should set the category on every entry of the group without confirming', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD 1234' },
        { fitId: 'F2', amount: '-32.10', memo: 'PAG*IFOOD 5678' },
      ]);
      const ids = await pendingIds(batch.id);

      const [error, result] = await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: ids,
        categoryId: 'cat-alimentacao',
      });
      expect(error).toBeNull();
      expect(result!.updated).toBe(2);

      const entries = await entryRepo.findPendingByBatchId(batch.id);
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.categoryId === 'cat-alimentacao')).toBe(
        true,
      );
      // Continua pendente: categorizar não é confirmar.
      expect(entries.every((e) => e.status === 'pending')).toBe(true);

      const stored = await vaultRepo.findById(vault.id);
      expect(stored!.transactions.size).toBe(0);
    });

    it('should be reversible while nothing is confirmed', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD 1234' },
      ]);
      const ids = await pendingIds(batch.id);

      await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: ids,
        categoryId: 'cat-errada',
      });
      await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: ids,
        categoryId: 'cat-certa',
      });

      const [entry] = await entryRepo.findPendingByBatchId(batch.id);
      expect(entry.categoryId).toBe('cat-certa');
    });

    it('should skip entries that are already confirmed', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD 1234' },
      ]);
      const ids = await pendingIds(batch.id);
      await service.confirmEntries({ vaultId: vault.id, entryIds: ids });

      const [, result] = await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: ids,
        categoryId: 'cat-nova',
      });
      expect(result!.updated).toBe(0);
    });

    it('should carry the category into the transaction on confirmation', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD 1234' },
      ]);
      const ids = await pendingIds(batch.id);

      await service.categorizeEntries({
        vaultId: vault.id,
        entryIds: ids,
        categoryId: 'cat-alimentacao',
      });
      await service.confirmEntries({ vaultId: vault.id, entryIds: ids });

      const stored = await vaultRepo.findById(vault.id);
      const [transaction] = [...stored!.transactions.values()];
      expect(transaction.categoryId).toBe('cat-alimentacao');
    });
  });

  describe('confirmação', () => {
    it('should create a committed transaction that moves the balance', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
      ]);
      const [error, result] = await service.confirmEntries({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
      });

      expect(error).toBeNull();
      expect(result!.confirmed).toBe(1);

      const stored = await vaultRepo.findById(vault.id);
      const [transaction] = [...stored!.transactions.values()];
      expect(transaction.isCommitted).toBe(true);
      expect(transaction.amount).toBe(45.9);
      expect(transaction.type).toBe('expense');
      expect(transaction.boxId).toBe(box.id);
      expect(stored!.getBalance()).toBe(-45.9);
    });

    it('should carry the edited values into the transaction', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
      ]);
      const [entryId] = await pendingIds(batch.id);

      await service.editEntry({
        vaultId: vault.id,
        entryId,
        changes: { amount: 60, description: 'Almoço com cliente' },
      });
      await service.confirmEntries({ vaultId: vault.id, entryIds: [entryId] });

      const stored = await vaultRepo.findById(vault.id);
      const [transaction] = [...stored!.transactions.values()];
      expect(transaction.amount).toBe(60);
      expect(transaction.description).toBe('Almoço com cliente');
    });

    it('should keep the raw values so dedup still recognises the line', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
      ]);
      const [entryId] = await pendingIds(batch.id);
      await service.editEntry({
        vaultId: vault.id,
        entryId,
        changes: { description: 'Almoço com cliente', amount: 60 },
      });

      const [second] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
      ]);
      expect(second.duplicateCount).toBe(1);
    });

    it('should confirm every pending entry of a batch at once', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-10.00', memo: 'A' },
        { fitId: 'F2', amount: '-20.00', memo: 'B' },
        { fitId: 'F3', amount: '-30.00', memo: 'C' },
      ]);
      const [error, result] = await service.confirmBatch({
        vaultId: vault.id,
        batchId: batch.id,
      });

      expect(error).toBeNull();
      expect(result!.confirmed).toBe(3);
      const stored = await vaultRepo.findById(vault.id);
      expect(stored!.getBalance()).toBe(-60);
    });

    it('should skip an entry that is no longer pending instead of failing', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-10.00', memo: 'A' },
      ]);
      const ids = await pendingIds(batch.id);
      await service.confirmEntries({ vaultId: vault.id, entryIds: ids });

      const [error, result] = await service.confirmEntries({
        vaultId: vault.id,
        entryIds: ids,
      });
      expect(error).toBeNull();
      expect(result!.confirmed).toBe(0);
      expect(result!.skipped).toEqual(ids);
    });
  });

  describe('confirmar como transferência', () => {
    it('should create a pair and leave the total balance untouched', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-2000.00', memo: 'TED RESERVA' },
      ]);
      const ids = await pendingIds(batch.id);

      const [error, result] = await service.confirmAsTransfer({
        vaultId: vault.id,
        entryIds: ids,
        boxId: reserva.id,
      });
      expect(error).toBeNull();
      expect(result!.confirmed).toBe(1);

      const stored = await vaultRepo.findById(vault.id);
      const transactions = [...stored!.transactions.values()];
      expect(transactions).toHaveLength(2);
      // O dinheiro continua sendo do usuário: sai de um estrato e entra no outro.
      expect(stored!.getBalance({ includeAll: true })).toBe(0);
    });

    it('should move the money out of the account and into the chosen estrato', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-2000.00', memo: 'TED RESERVA' },
      ]);
      await service.confirmAsTransfer({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
        boxId: reserva.id,
      });

      const stored = await vaultRepo.findById(vault.id);
      const transactions = [...stored!.transactions.values()];
      const saida = transactions.find((t) => t.type === 'expense')!;
      const entrada = transactions.find((t) => t.type === 'income')!;
      expect(saida.boxId).toBe(box.id);
      expect(entrada.boxId).toBe(reserva.id);
      expect(saida.transferId).toBe(entrada.transferId);
    });

    it('should invert the direction for an incoming line', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '2000.00', memo: 'RESGATE RESERVA' },
      ]);
      await service.confirmAsTransfer({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
        boxId: reserva.id,
      });

      const stored = await vaultRepo.findById(vault.id);
      const transactions = [...stored!.transactions.values()];
      const saida = transactions.find((t) => t.type === 'expense')!;
      const entrada = transactions.find((t) => t.type === 'income')!;
      expect(saida.boxId).toBe(reserva.id);
      expect(entrada.boxId).toBe(box.id);
    });

    it('should leave no category behind, so budgets are untouched', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-2000.00', memo: 'TED RESERVA' },
      ]);
      await service.confirmAsTransfer({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
        boxId: reserva.id,
      });

      const stored = await vaultRepo.findById(vault.id);
      const transactions = [...stored!.transactions.values()];
      expect(transactions.every((t) => t.categoryId === null)).toBe(true);
    });

    it('should mark the entry confirmed so it does not come back', async () => {
      const lines: Line[] = [
        { fitId: 'F1', amount: '-2000.00', memo: 'TED RESERVA' },
      ];
      const [batch] = await ingest(lines);
      await service.confirmAsTransfer({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
        boxId: reserva.id,
      });

      const [second] = await ingest(lines);
      expect(await entryRepo.findPendingByBatchId(second.id)).toHaveLength(0);
      expect(second.duplicateCount).toBe(1);
    });

    it('should refuse an estrato that is not in the vault', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-2000.00', memo: 'TED RESERVA' },
      ]);
      const [error] = await service.confirmAsTransfer({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
        boxId: 'estrato-de-outro-vault',
      });
      expect(error).not.toBeNull();
    });

    it('should skip a line whose estrato is the destination itself', async () => {
      // Transferir para o mesmo estrato não é movimento nenhum.
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-2000.00', memo: 'TED' },
      ]);
      const [, result] = await service.confirmAsTransfer({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
        boxId: box.id,
      });
      expect(result!.confirmed).toBe(0);

      const stored = await vaultRepo.findById(vault.id);
      expect(stored!.transactions.size).toBe(0);
    });
  });

  describe('descarte', () => {
    it('should create no transaction when an entry is dismissed', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
      ]);
      const [entryId] = await pendingIds(batch.id);
      await service.dismissEntry({ vaultId: vault.id, entryId });

      const stored = await vaultRepo.findById(vault.id);
      expect(stored!.transactions.size).toBe(0);
      expect(stored!.getBalance()).toBe(0);
    });

    it('should not bring a dismissed line back on a re-import', async () => {
      const lines: Line[] = [
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
      ];
      const [batch] = await ingest(lines);
      const [entryId] = await pendingIds(batch.id);
      await service.dismissEntry({ vaultId: vault.id, entryId });

      const [second] = await ingest(lines);
      expect(await entryRepo.findPendingByBatchId(second.id)).toHaveLength(0);
      expect(second.duplicateCount).toBe(1);
    });
  });

  describe('transação deletada depois', () => {
    it('should keep the entry confirmed so a re-import does not resurrect it', async () => {
      const lines: Line[] = [
        { fitId: 'F1', amount: '-45.90', memo: 'PAG*IFOOD' },
      ];
      const [batch] = await ingest(lines);
      const [entryId] = await pendingIds(batch.id);
      await service.confirmEntries({ vaultId: vault.id, entryIds: [entryId] });

      const entry = await entryRepo.findById(entryId);
      await service.detachTransaction(entry!.transactionId!);

      const after = await entryRepo.findById(entryId);
      expect(after!.status).toBe('confirmed');
      expect(after!.transactionId).toBeNull();

      const [second] = await ingest(lines);
      expect(await entryRepo.findPendingByBatchId(second.id)).toHaveLength(0);
    });
  });

  describe('vínculo conta → estrato', () => {
    it('should reuse the estrato chosen for the account on a later import', async () => {
      await ingest([{ fitId: 'F1', amount: '-10.00', memo: 'A' }]);

      const [error, batches] = await service.ingest({
        vaultId: vault.id,
        file: ofxFile([{ fitId: 'F2', amount: '-20.00', memo: 'B' }]),
        // sem boxId: deve lembrar o que foi escolhido para esta conta
      });
      expect(error).toBeNull();
      expect(batches![0].boxId).toBe(box.id);
    });
  });

  describe('importações em aberto', () => {
    it('should report how many lines each import still has pending', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-10.00', memo: 'A' },
        { fitId: 'F2', amount: '-20.00', memo: 'B' },
      ]);

      const listed = await service.listBatches(vault.id);
      expect(listed).toHaveLength(1);
      expect(listed[0].batch.id).toBe(batch.id);
      expect(listed[0].pendingCount).toBe(2);
    });

    it('should drop the count to zero once everything is decided', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-10.00', memo: 'A' },
        { fitId: 'F2', amount: '-20.00', memo: 'B' },
      ]);
      await service.confirmBatch({ vaultId: vault.id, batchId: batch.id });

      const listed = await service.listBatches(vault.id);
      expect(listed[0].pendingCount).toBe(0);
    });

    it('should keep a half-reviewed import findable', async () => {
      // É o caso que deixava trabalho preso: reenviar o arquivo não recupera,
      // porque a deduplicação recusa recriar linhas já vistas.
      const lines: Line[] = [
        { fitId: 'F1', amount: '-10.00', memo: 'A' },
        { fitId: 'F2', amount: '-20.00', memo: 'B' },
      ];
      const [first] = await ingest(lines);
      const [oneId] = await pendingIds(first.id);
      await service.confirmEntries({ vaultId: vault.id, entryIds: [oneId] });

      // Reenviar o mesmo arquivo não traz nada de volta.
      const [second] = await ingest(lines);
      expect(await entryRepo.findPendingByBatchId(second.id)).toHaveLength(0);

      // Mas o lote original continua listado, com a pendência restante.
      const listed = await service.listBatches(vault.id);
      const stranded = listed.find((l) => l.batch.id === first.id);
      expect(stranded!.pendingCount).toBe(1);
    });

    it('should not leak imports from another vault', async () => {
      await ingest([{ fitId: 'F1', amount: '-10.00', memo: 'A' }]);
      expect(await service.listBatches('outro-vault')).toHaveLength(0);
    });
  });

  describe('revisão', () => {
    it('should report the counts and the duplicate lines of the batch', async () => {
      const lines: Line[] = [
        { fitId: 'F1', amount: '-10.00', memo: 'A' },
        { fitId: 'F2', amount: '-20.00', memo: 'B' },
      ];
      await ingest(lines);
      const [batch] = await ingest([
        ...lines,
        { fitId: 'F3', amount: '-30.00', memo: 'C' },
      ]);

      const [error, review] = await service.getReview({
        vaultId: vault.id,
        batchId: batch.id,
      });
      expect(error).toBeNull();
      expect(review!.counts.pending).toBe(1);
      expect(review!.duplicateCount).toBe(2);
      expect(review!.entries.items).toHaveLength(1);
    });

    it('should not expose a batch from another vault', async () => {
      const [batch] = await ingest([
        { fitId: 'F1', amount: '-10.00', memo: 'A' },
      ]);
      const [error] = await service.getReview({
        vaultId: 'outro-vault',
        batchId: batch.id,
      });
      expect(error).not.toBeNull();
    });
  });

  describe('cartão e pagamento de fatura', () => {
    /** Extrato do cartão de um ciclo (03/08 a 02/09). */
    const cartao = (
      lines: Line[],
      ledgerBalance: string | null,
      accountId = 'cartao-1',
    ) =>
      Buffer.from(
        `OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CURDEF>BRL
<CCACCTFROM>
<ACCTID>${accountId}
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260803
<DTEND>20260902
${lines
  .map(
    (l) => `<STMTTRN>
<TRNTYPE>${l.amount.startsWith('-') ? 'DEBIT' : 'CREDIT'}
<DTPOSTED>${l.date ?? '20260815'}000000[-3:BRT]
<TRNAMT>${l.amount}
<FITID>${l.fitId}
<MEMO>${l.memo}
</STMTTRN>`,
  )
  .join('\n')}
</BANKTRANLIST>
${ledgerBalance === null ? '' : `<LEDGERBAL>\n<BALAMT>${ledgerBalance}\n<DTASOF>20260902\n</LEDGERBAL>`}
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`,
        'latin1',
      );

    const ingestCartao = async (
      lines: Line[],
      ledgerBalance: string | null = '-2050.00',
      accountId?: string,
    ) => {
      const [error, batches] = await service.ingest({
        vaultId: vault.id,
        file: cartao(lines, ledgerBalance, accountId),
        boxId: box.id,
      });
      expect(error).toBeNull();
      return batches![0];
    };

    const compras: Line[] = [
      { fitId: 'C1', amount: '-1000.00', memo: 'MERCADO', date: '20260812' },
      { fitId: 'C2', amount: '-1050.00', memo: 'POSTO', date: '20260820' },
      {
        fitId: 'C3',
        amount: '1500.00',
        memo: 'Pagamento recebido',
        date: '20260805',
      },
      {
        fitId: 'C4',
        amount: '-300.00',
        memo: 'Saldo em atraso',
        date: '20260803',
      },
    ];

    /** Importa o débito de R$ 3.200 em 10/09 e o confirma como pagamento. */
    const pagarFatura = async (
      amount = '-3200.00',
      target: { cardId?: string; invoiceId?: string } = {},
    ) => {
      const [batch] = await ingest([
        { fitId: 'P1', amount, memo: 'PAGAMENTO FATURA', date: '20260910' },
      ]);
      const [error, result] = await service.confirmAsInvoicePayment({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
        ...target,
      });
      expect(error).toBeNull();
      expect(result!.confirmed).toBe(1);
      return result!;
    };

    const spent = (month: number) =>
      vault.totalSpentAmount({ month, year: 2026 }, { includeAll: true });
    const income = (month: number) =>
      vault.totalIncomeAmount({ month, year: 2026 }, { includeAll: true });
    const remainders = () =>
      [...vault.transactions.values()].filter((t) => t.isInvoiceRemainder);

    it('o extrato do cartão cria o cartão e a fatura do período; as compras esperam o pagamento', async () => {
      const batch = await ingestCartao(compras);

      const card = [...vault.cards.values()][0];
      expect(card).toMatchObject({
        name: 'Cartão cartao-1',
        closingDay: 2,
        dueDay: 9,
        boxId: box.id,
        accountKey: batch.accountKey,
      });
      const invoice = vault.invoices.get(batch.invoiceId!)!;
      expect(invoice.periodStart).toEqual(new Date(Date.UTC(2026, 7, 3)));
      expect(invoice.closingDate).toEqual(new Date(Date.UTC(2026, 8, 2)));

      // "Pagamento recebido" e o saldo da fatura anterior não chegam à triagem.
      const [, review] = await service.getReview({
        vaultId: vault.id,
        batchId: batch.id,
        status: 'dismissed',
      });
      expect(review!.entries.items.map((e) => e.fitId).sort()).toEqual([
        'C3',
        'C4',
      ]);

      await service.confirmBatch({ vaultId: vault.id, batchId: batch.id });
      expect(spent(8)).toBe(0);
      expect(income(8) + income(9)).toBe(0);
      expect(vault.getCardPayable(card.id)).toBe(2050);

      // Um segundo extrato da mesma conta cai no mesmo cartão.
      await ingestCartao(
        [{ fitId: 'D1', amount: '-10.00', memo: 'PADARIA', date: '20260905' }],
        null,
      );
      expect(vault.cards.size).toBe(1);
    });

    it('o pagamento sugere o cartão e a fatura, paga as compras e o resto fica não discriminado', async () => {
      const cardBatch = await ingestCartao(compras);
      await service.confirmBatch({ vaultId: vault.id, batchId: cardBatch.id });

      const [bank] = await ingest([
        {
          fitId: 'P1',
          amount: '-3200.00',
          memo: 'PAGAMENTO FATURA',
          date: '20260910',
        },
      ]);
      const [, groups] = await service.getGroups({
        vaultId: vault.id,
        batchId: bank.id,
      });
      expect(groups![0]).toMatchObject({
        suggestsInvoice: true,
        suggestedInvoicePayment: {
          cardName: 'Cartão cartao-1',
          invoiceId: cardBatch.invoiceId,
        },
      });

      const [, result] = await service.confirmAsInvoicePayment({
        vaultId: vault.id,
        entryIds: groups![0].entryIds,
      });
      expect(result!.invoiceIds).toEqual([cardBatch.invoiceId]);
      expect(spent(8)).toBe(0);
      expect(spent(9)).toBe(3200);
      expect(remainders().map((t) => t.amount)).toEqual([1150]);

      const [, list] = await invoiceService.listInvoices(vault.id);
      expect(list!.invoices[0]).toMatchObject({
        purchasesTotal: 2050,
        paid: 3200,
        overpaid: 1150,
        notItemized: 1150,
        status: 'overpaid',
      });
      // A linha da conta corrente não virou transação própria.
      const [, confirmed] = await service.getReview({
        vaultId: vault.id,
        batchId: bank.id,
        status: 'confirmed',
      });
      expect(confirmed!.entries.items[0].transactionId).toBeNull();
    });

    it('pagamento antes do extrato: cria um cartão, conta tudo como não discriminado e o extrato depois o detalha', async () => {
      const result = await pagarFatura();
      expect(vault.cards.size).toBe(1);
      const card = [...vault.cards.values()][0];
      expect(card.accountKey).toBeNull();
      expect(spent(9)).toBe(3200);
      expect(remainders()[0].amount).toBe(3200);

      const batch = await ingestCartao(compras);
      // O cartão criado pelo pagamento assume a conta do extrato, e a fatura
      // paga é a do período do extrato.
      expect(vault.cards.size).toBe(1);
      expect(card.accountKey).toBe(batch.accountKey);
      expect(batch.invoiceId).toBe(result.invoiceIds[0]);

      await service.confirmBatch({ vaultId: vault.id, batchId: batch.id });
      expect(spent(8)).toBe(0);
      expect(spent(9)).toBe(3200);
      expect(remainders()[0].amount).toBe(1150);
    });

    it('um pagamento informado à mão recebe o débito importado em vez de virar outro', async () => {
      const [, card] = await invoiceService.createCard(vault.id, {
        name: 'Nubank',
        closingDay: 2,
        dueDay: 9,
      });
      const [error, manual] = await invoiceService.addPayment(vault.id, {
        cardId: card!.id,
        amount: 3200,
        date: new Date(Date.UTC(2026, 8, 8)),
      });
      expect(error).toBeNull();
      expect(manual!.payment.imported).toBe(false);

      const result = await pagarFatura();
      expect(result.paymentIds).toEqual([manual!.payment.id]);
      expect(vault.payments.size).toBe(1);
      const payment = vault.payments.get(manual!.payment.id)!;
      expect(payment.imported).toBe(true);
      expect(payment.date).toEqual(new Date(Date.UTC(2026, 8, 10)));
      expect(spent(9)).toBe(3200);
    });

    it('extrato antigo pode ser marcado sem fatura; extrato de conta corrente não', async () => {
      const [bank] = await ingest([
        { fitId: 'X1', amount: '-10.00', memo: 'PADARIA' },
      ]);
      expect(
        (await invoiceService.setBatchNoInvoice(vault.id, bank.id, true))[0],
      ).not.toBeNull();
      expect(
        (await invoiceService.setBatchInvoice(vault.id, bank.id, null))[0],
      ).not.toBeNull();
    });

    it('não confirma pagamento de outro vault nem de uma linha de receita', async () => {
      const [batch] = await ingest([
        { fitId: 'R1', amount: '100.00', memo: 'ESTORNO FATURA' },
      ]);
      const [, result] = await service.confirmAsInvoicePayment({
        vaultId: vault.id,
        entryIds: await pendingIds(batch.id),
      });
      expect(result!.confirmed).toBe(0);

      const [otherError] = await service.confirmAsInvoicePayment({
        vaultId: 'outro-vault',
        entryIds: await pendingIds(batch.id),
      });
      expect(otherError).not.toBeNull();
    });
  });
});
