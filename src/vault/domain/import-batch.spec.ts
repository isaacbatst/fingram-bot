import { describe, it, expect } from 'vitest';
import { ImportBatch } from './import-batch';

const baseParams = {
  vaultId: 'vault-1',
  accountKey: '0260:111:CHECKING',
  boxId: 'box-1',
};

describe('ImportBatch', () => {
  it('should start under review with no duplicates counted', () => {
    const batch = ImportBatch.create(baseParams);
    expect(batch.status).toBe('reviewing');
    expect(batch.duplicateCount).toBe(0);
    expect(batch.id).toBeDefined();
  });

  it('should default to a bank account', () => {
    expect(ImportBatch.create(baseParams).kind).toBe('bank');
  });

  it('should keep the statement metadata used by the review summary', () => {
    const batch = ImportBatch.create({
      ...baseParams,
      kind: 'creditcard',
      accountLabel: 'Nubank cartão',
      currency: 'BRL',
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 0, 31)),
      ledgerBalance: 6219.54,
      fileName: 'extrato.ofx',
      duplicateCount: 8,
    });
    expect(batch.kind).toBe('creditcard');
    expect(batch.accountLabel).toBe('Nubank cartão');
    expect(batch.ledgerBalance).toBe(6219.54);
    expect(batch.duplicateCount).toBe(8);
    expect(batch.periodEnd).toEqual(new Date(Date.UTC(2026, 0, 31)));
  });

  it('should close the review', () => {
    const batch = ImportBatch.create(baseParams);
    batch.markDone();
    expect(batch.status).toBe('done');
  });
});
