import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaultQueryService } from './vault-query.service';
import { InMemoryStore } from '@/shared/persistence/in-memory/in-memory-store';
import { TransactionInMemoryRepository } from '@/vault/repositories/in-memory/transaction-in-memory.repository';
import { BoxInMemoryRepository } from '@/vault/repositories/in-memory/box-in-memory.repository';
import { Vault } from '@/vault/domain/vault';
import { Transaction } from '@/vault/domain/transaction';

const day = (year: number, month: number, dayOfMonth: number) =>
  new Date(Date.UTC(year, month - 1, dayOfMonth));

describe('VaultQueryService.getDailyActivity', () => {
  let service: VaultQueryService;
  let store: InMemoryStore;
  let vault: Vault;

  const addTransaction = (date: Date, amount: number, type: 'income' | 'expense') => {
    const transaction = Transaction.create({
      vaultId: vault.id,
      amount,
      type,
      date,
    });
    vault.addTransaction(transaction);
    vault.commitTransaction(transaction.id);
  };

  beforeEach(() => {
    // "Hoje" fixo numa quinta-feira, para o alinhamento de semana ser verificável.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T12:00:00.000Z'));

    store = new InMemoryStore();
    vault = new Vault();
    store.vaults.set(vault.id, vault);

    service = new VaultQueryService(
      new BoxInMemoryRepository(),
      new TransactionInMemoryRepository(store),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should count the transactions of each day', async () => {
    addTransaction(day(2026, 8, 10), 10, 'expense');
    addTransaction(day(2026, 8, 10), 20, 'expense');
    addTransaction(day(2026, 8, 12), 30, 'expense');

    const { days } = await service.getDailyActivity(vault.id);
    const byDate = new Map(days.map((d) => [d.date, d]));

    expect(byDate.get('2026-08-10')!.count).toBe(2);
    expect(byDate.get('2026-08-12')!.count).toBe(1);
  });

  it('should not shift a transaction to the previous day', async () => {
    // O servidor roda em UTC-3: usar métodos locais jogaria a meia-noite UTC
    // do dia 13 para o dia 12.
    addTransaction(day(2026, 8, 13), 45.9, 'expense');

    const { days } = await service.getDailyActivity(vault.id);
    expect(days.map((d) => d.date)).toContain('2026-08-13');
    expect(days.map((d) => d.date)).not.toContain('2026-08-12');
  });

  it('should sum only the expenses in the daily total', async () => {
    addTransaction(day(2026, 8, 10), 10, 'expense');
    addTransaction(day(2026, 8, 10), 500, 'income');

    const { days } = await service.getDailyActivity(vault.id);
    const dia = days.find((d) => d.date === '2026-08-10')!;
    expect(dia.count).toBe(2);
    expect(dia.expenseTotal).toBe(10);
  });

  it('should start the window on a Sunday so every column is a full week', async () => {
    const { startDate } = await service.getDailyActivity(vault.id);
    expect(startDate.getUTCDay()).toBe(0);
  });

  it('should cover the requested number of weeks', async () => {
    const { startDate, endDate } = await service.getDailyActivity(vault.id, 20);
    const dias = Math.round(
      (endDate.getTime() - startDate.getTime()) / 86_400_000,
    );
    // 20 semanas mais o recuo até o domingo, então nunca menos que 140 dias.
    expect(dias).toBeGreaterThanOrEqual(140);
    expect(dias).toBeLessThan(147 + 7);
  });

  it('should include today', async () => {
    addTransaction(day(2026, 8, 13), 10, 'expense');
    const { days } = await service.getDailyActivity(vault.id);
    expect(days.some((d) => d.date === '2026-08-13')).toBe(true);
  });

  it('should leave out what falls before the window', async () => {
    addTransaction(day(2025, 1, 1), 10, 'expense');
    const { days } = await service.getDailyActivity(vault.id);
    expect(days.some((d) => d.date === '2025-01-01')).toBe(false);
  });

  it('should ignore uncommitted transactions', async () => {
    const pendente = Transaction.create({
      vaultId: vault.id,
      amount: 99,
      type: 'expense',
      date: day(2026, 8, 11),
    });
    vault.addTransaction(pendente);

    const { days } = await service.getDailyActivity(vault.id);
    expect(days.some((d) => d.date === '2026-08-11')).toBe(false);
  });
});
