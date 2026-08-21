import { describe, it, expect, beforeEach } from 'vitest';
import { ImportService } from './import.service';
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

describe('ImportService', () => {
  let service: ImportService;
  let store: InMemoryStore;
  let vaultRepo: VaultInMemoryRepository;
  let entryRepo: ImportEntryInMemoryRepository;
  let vault: Vault;
  let box: Box;

  beforeEach(async () => {
    store = new InMemoryStore();
    vaultRepo = new VaultInMemoryRepository(store);
    const boxRepo = new BoxInMemoryRepository();
    const batchRepo = new ImportBatchInMemoryRepository();
    entryRepo = new ImportEntryInMemoryRepository();

    vault = new Vault();
    await vaultRepo.create(vault);
    box = Box.create({ vaultId: vault.id, name: 'Nubank', isDefault: true });
    await boxRepo.create(box);

    service = new ImportService(vaultRepo, boxRepo, batchRepo, entryRepo);
  });

  const ingest = async (lines: Line[], accountId?: string) => {
    const [error, batches] = await service.ingest({
      vaultId: vault.id,
      file: ofxFile(lines, accountId),
      fileName: 'extrato.ofx',
      boxId: box.id,
    });
    expect(error).toBeNull();
    return batches!;
  };

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
});
