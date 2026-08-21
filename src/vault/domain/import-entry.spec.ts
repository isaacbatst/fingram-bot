import { describe, it, expect } from 'vitest';
import { ImportEntry } from './import-entry';

const baseParams = {
  vaultId: 'vault-1',
  batchId: 'batch-1',
  accountKey: '0260:111:CHECKING',
  boxId: 'box-1',
  fitId: 'FIT-1',
  rawDate: new Date(Date.UTC(2026, 0, 15)),
  rawAmount: -45.9,
  rawType: 'expense' as const,
  rawMemo: 'PAG*IFOOD 1234',
  rawName: null,
};

describe('ImportEntry.create', () => {
  it('should start pending with no transaction attached', () => {
    const entry = ImportEntry.create(baseParams);
    expect(entry.status).toBe('pending');
    expect(entry.transactionId).toBeNull();
  });

  it('should seed the working values from the raw ones', () => {
    const entry = ImportEntry.create(baseParams);
    expect(entry.date).toEqual(baseParams.rawDate);
    expect(entry.type).toBe('expense');
    expect(entry.description).toBe('PAG*IFOOD 1234');
  });

  it('should store the amount as a positive number', () => {
    const entry = ImportEntry.create(baseParams);
    expect(entry.rawAmount).toBe(-45.9);
    expect(entry.amount).toBe(45.9);
  });

  it('should fall back to NAME when MEMO is absent', () => {
    const entry = ImportEntry.create({
      ...baseParams,
      rawMemo: null,
      rawName: 'UBER *TRIP',
    });
    expect(entry.description).toBe('UBER *TRIP');
  });

  it('should default to no classification', () => {
    const entry = ImportEntry.create(baseParams);
    expect(entry.suggestionSource).toBe('none');
    expect(entry.suggestedCategoryId).toBeNull();
    expect(entry.categoryId).toBeNull();
  });
});

describe('ImportEntry.matchKey', () => {
  it('should normalize the raw description', () => {
    const entry = ImportEntry.create({
      ...baseParams,
      rawMemo: '  pag*ifood 1234  ',
    });
    expect(entry.matchKey).toBe('PAG*IFOOD 1234');
  });

  it('should not change when the user edits the description', () => {
    // Protege a imutabilidade do bruto: se a chave passasse a usar o texto editado,
    // o casamento por histórico degradaria em silêncio.
    const entry = ImportEntry.create(baseParams);
    const before = entry.matchKey;
    entry.edit({ description: 'Almoço com cliente' });
    expect(entry.description).toBe('Almoço com cliente');
    expect(entry.matchKey).toBe(before);
  });
});

describe('ImportEntry.edit', () => {
  it('should apply the working changes', () => {
    const entry = ImportEntry.create(baseParams);
    const newDate = new Date(Date.UTC(2026, 0, 20));
    const [error] = entry.edit({
      date: newDate,
      amount: 50,
      type: 'income',
      categoryId: 'cat-1',
      boxId: 'box-2',
    });
    expect(error).toBeNull();
    expect(entry.date).toEqual(newDate);
    expect(entry.amount).toBe(50);
    expect(entry.type).toBe('income');
    expect(entry.categoryId).toBe('cat-1');
    expect(entry.boxId).toBe('box-2');
  });

  it('should never touch the raw values', () => {
    const entry = ImportEntry.create(baseParams);
    entry.edit({ amount: 999, date: new Date(Date.UTC(2030, 0, 1)) });
    expect(entry.rawAmount).toBe(-45.9);
    expect(entry.rawDate).toEqual(baseParams.rawDate);
    expect(entry.rawMemo).toBe('PAG*IFOOD 1234');
  });

  it('should leave untouched fields alone', () => {
    const entry = ImportEntry.create(baseParams);
    entry.edit({ categoryId: 'cat-1' });
    expect(entry.amount).toBe(45.9);
    expect(entry.description).toBe('PAG*IFOOD 1234');
  });

  it('should reject a non-positive amount', () => {
    const entry = ImportEntry.create(baseParams);
    const [error] = entry.edit({ amount: 0 });
    expect(error).not.toBeNull();
    expect(entry.amount).toBe(45.9);
  });

  it('should reject editing an entry that is no longer pending', () => {
    const entry = ImportEntry.create(baseParams);
    entry.confirm('tx-1');
    const [error] = entry.edit({ amount: 10 });
    expect(error).not.toBeNull();
    expect(entry.amount).toBe(45.9);
  });
});

describe('ImportEntry.confirm', () => {
  it('should attach the created transaction', () => {
    const entry = ImportEntry.create(baseParams);
    const [error] = entry.confirm('tx-1');
    expect(error).toBeNull();
    expect(entry.status).toBe('confirmed');
    expect(entry.transactionId).toBe('tx-1');
  });

  it('should reject confirming twice', () => {
    const entry = ImportEntry.create(baseParams);
    entry.confirm('tx-1');
    const [error] = entry.confirm('tx-2');
    expect(error).not.toBeNull();
    expect(entry.transactionId).toBe('tx-1');
  });

  it('should reject confirming a dismissed entry', () => {
    const entry = ImportEntry.create(baseParams);
    entry.dismiss();
    const [error] = entry.confirm('tx-1');
    expect(error).not.toBeNull();
    expect(entry.status).toBe('dismissed');
  });
});

describe('ImportEntry.dismiss', () => {
  it('should mark the entry dismissed without a transaction', () => {
    const entry = ImportEntry.create(baseParams);
    const [error] = entry.dismiss();
    expect(error).toBeNull();
    expect(entry.status).toBe('dismissed');
    expect(entry.transactionId).toBeNull();
  });

  it('should reject dismissing a confirmed entry', () => {
    const entry = ImportEntry.create(baseParams);
    entry.confirm('tx-1');
    const [error] = entry.dismiss();
    expect(error).not.toBeNull();
    expect(entry.status).toBe('confirmed');
  });
});

describe('ImportEntry.detachTransaction', () => {
  it('should keep the entry confirmed so a re-import does not resurrect it', () => {
    const entry = ImportEntry.create(baseParams);
    entry.confirm('tx-1');
    entry.detachTransaction();
    expect(entry.transactionId).toBeNull();
    expect(entry.status).toBe('confirmed');
  });
});
