/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/shared/persistence/drizzle/schema';
import { VaultDrizzleRepository } from '@/vault/repositories/drizzle/vault-drizzle.repository';
import { TransactionDrizzleRepository } from '@/vault/repositories/drizzle/transaction-drizzle.repository';
import { Vault } from '@/vault/domain/vault';

const MIGRATIONS = resolve(__dirname, '../../drizzle');
const d = (month: number, day: number) =>
  new Date(Date.UTC(2026, month - 1, day));

/** Uma cópia da pasta de migrações só até a 0014 (o modelo antigo de fatura). */
function migrationsUpTo(lastIdx: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'drizzle-old-'));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e: any) => e.idx <= lastIdx);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

/**
 * Prova a migração dos dados de produção: monta faturas no modelo antigo
 * (uma fatura por pagamento, resto não discriminado, compras contando na data
 * do pagamento) com o schema da 0014, roda as migrações novas e confere o
 * modelo novo, os totais por mês e que o agregado não tem nada a recalcular.
 */
describe('Migração card_invoice → cartão + faturas + pagamentos (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  const V = 'vault-1';
  const V2 = 'vault-2';
  const runSql = (query: string) => pool.query(query);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: migrationsUpTo(14) });

    // --- Dados no modelo antigo -------------------------------------------
    for (const [vault, box, cat] of [
      [V, 'box-1', 'cat-1'],
      [V2, 'box-2', 'cat-2'],
    ]) {
      await runSql(
        `INSERT INTO vault (id, token, created_at) VALUES ('${vault}', 't-${vault}', now())`,
      );
      await runSql(`INSERT INTO box (id, vault_id, name, is_default, type, created_at)
        VALUES ('${box}', '${vault}', 'Conta', true, 'spending', now())`);
      await runSql(`INSERT INTO vault_category (id, vault_id, name, code, transaction_type)
        VALUES ('${cat}', '${vault}', 'Mercado', 'm', 'expense')`);
    }

    const invoice = (
      id: string,
      vault: string,
      box: string,
      amount: number,
      paid: Date,
    ) =>
      runSql(`INSERT INTO card_invoice (id, vault_id, box_id, amount, payment_date, card_label, has_payment_line, created_at)
        VALUES ('${id}', '${vault}', '${box}', ${amount}, '${paid.toISOString()}', NULL, true, now())`);
    const tx = (
      id: string,
      vault: string,
      box: string,
      amount: number,
      type: 'income' | 'expense',
      date: Date,
      extra: {
        invoiceId?: string;
        purchaseDate?: Date;
        categoryId?: string;
      } = {},
    ) =>
      runSql(`INSERT INTO "transaction" (id, code, amount, type, category_id, vault_id, description, created_at, committed, date, box_id, invoice_id, purchase_date)
        VALUES ('${id}', 'c${id.slice(-3)}', ${amount}, '${type}', ${extra.categoryId ? `'${extra.categoryId}'` : 'NULL'}, '${vault}', '${id}', '2026-01-01', true, '${date.toISOString()}', '${box}',
        ${extra.invoiceId ? `'${extra.invoiceId}'` : 'NULL'}, ${extra.purchaseDate ? `'${extra.purchaseDate.toISOString()}'` : 'NULL'})`);

    // Vault 1, fatura A: extrato do cartão ligado, pago 3.200 em 10/09,
    // compras de 1.000 e 1.050 ligadas, resto 1.150.
    await invoice('inv-a', V, 'box-1', 3200, d(9, 10));
    await runSql(`INSERT INTO import_batch (id, vault_id, account_key, account_label, box_id, kind, period_start, period_end, ledger_balance, status, invoice_id, created_at)
      VALUES ('batch-card', '${V}', 'K:5c9e:CC', 'Cartão 5c9e', 'box-1', 'creditcard', '2026-08-03', '2026-09-02', -3200, 'done', 'inv-a', now())`);
    await runSql(`INSERT INTO import_batch (id, vault_id, account_key, box_id, kind, status, created_at)
      VALUES ('batch-bank', '${V}', 'B:1:CHECKING', 'box-1', 'bank', 'done', now())`);
    await tx('p-mercado', V, 'box-1', 1000, 'expense', d(9, 10), {
      invoiceId: 'inv-a',
      purchaseDate: d(8, 12),
      categoryId: 'cat-1',
    });
    await tx('p-posto', V, 'box-1', 1050, 'expense', d(9, 10), {
      invoiceId: 'inv-a',
      purchaseDate: d(8, 20),
      categoryId: 'cat-1',
    });
    await tx('rest-a', V, 'box-1', 1150, 'expense', d(9, 10), {
      invoiceId: 'inv-a',
    });
    await runSql(`INSERT INTO import_entry (id, batch_id, vault_id, account_key, fit_id, raw_date, raw_amount, raw_type, raw_memo, date, amount, type, description, box_id, status, transaction_id, created_at)
      VALUES ('entry-pay', 'batch-bank', '${V}', 'B:1:CHECKING', 'P1', '2026-09-10', -3200, 'expense', 'PAGAMENTO FATURA', '2026-09-10', 3200, 'expense', 'PAGAMENTO FATURA', 'box-1', 'confirmed', 'rest-a', now())`);
    // Vault 1, fatura B: sem extrato, pago 500 em 10/10, nada detalhado.
    await invoice('inv-b', V, 'box-1', 500, d(10, 10));
    await tx('rest-b', V, 'box-1', 500, 'expense', d(10, 10), {
      invoiceId: 'inv-b',
    });
    // Uma transação comum não é tocada.
    await tx('normal', V, 'box-1', 42, 'expense', d(8, 5), {
      categoryId: 'cat-1',
    });

    // Vault 2: sem extrato, pago 300 em 05/09, compra de 200 e estorno de 50
    // ligados, resto 150.
    await invoice('inv-c', V2, 'box-2', 300, d(9, 5));
    await tx('p-compra', V2, 'box-2', 200, 'expense', d(9, 5), {
      invoiceId: 'inv-c',
      purchaseDate: d(8, 20),
      categoryId: 'cat-2',
    });
    await tx('p-estorno', V2, 'box-2', 50, 'income', d(9, 5), {
      invoiceId: 'inv-c',
      purchaseDate: d(8, 25),
    });
    await tx('rest-c', V2, 'box-2', 150, 'expense', d(9, 5), {
      invoiceId: 'inv-c',
    });

    // --- Migrações novas ---------------------------------------------------
    await migrate(db, { migrationsFolder: MIGRATIONS });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  const loadVault = async (id: string): Promise<Vault> =>
    (await new VaultDrizzleRepository(db as any, false).findById(id))!;

  it('cria cartões, faturas e pagamentos (o pagamento guarda o id da fatura antiga)', async () => {
    const cards = (await runSql(`SELECT * FROM card ORDER BY vault_id`)).rows;
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      vault_id: V,
      account_key: 'K:5c9e:CC',
      name: 'Cartão 5c9e',
      closing_day: 2,
      due_day: 9,
      box_id: 'box-1',
    });
    expect(cards[1]).toMatchObject({
      vault_id: V2,
      account_key: null,
      name: 'Cartão',
    });

    // Datas lidas como texto: o pg cru interpreta `timestamp` no fuso local.
    const payments = (
      await runSql(`SELECT p.*, c.card_id, to_char(c.period_start, 'YYYY-MM-DD') AS period_start,
      to_char(c.closing_date, 'YYYY-MM-DD') AS closing_date, to_char(c.due_date, 'YYYY-MM-DD') AS due_date
      FROM card_payment p JOIN card_cycle c ON c.id = p.invoice_id ORDER BY p.id`)
    ).rows;
    expect(payments.map((p) => p.id)).toEqual(['inv-a', 'inv-b', 'inv-c']);
    const a = payments[0];
    expect(a).toMatchObject({
      amount: 3200,
      imported: true,
      import_entry_id: 'entry-pay',
      card_id: cards[0].id,
    });
    expect(a.period_start).toBe('2026-08-03');
    expect(a.closing_date).toBe('2026-09-02');
    expect(a.due_date).toBe('2026-09-10');
    // Fatura sem extrato: fecha 7 dias antes do pagamento, no único cartão do vault.
    expect(payments[1].card_id).toBe(cards[0].id);
    expect(payments[1].closing_date).toBe('2026-10-03');

    const batch = (
      await runSql(
        `SELECT invoice_id FROM import_batch WHERE id = 'batch-card'`,
      )
    ).rows[0];
    expect(batch.invoice_id).toBe(a.invoice_id);
    const tables = (await runSql(`SELECT to_regclass('card_invoice') AS t`))
      .rows[0];
    expect(tables.t).toBeNull();
  });

  it('as compras voltam à data da compra como compras de cartão; o resto antigo sai', async () => {
    const rows = (
      await runSql(
        `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, invoice_role, purchase_date FROM "transaction" WHERE id IN ('p-mercado','p-estorno','rest-a','rest-b','normal') ORDER BY id`,
      )
    ).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['p-mercado']).toMatchObject({
      invoice_role: 'purchase',
      purchase_date: null,
    });
    expect(byId['p-mercado'].date).toBe('2026-08-12');
    expect(byId['p-estorno'].invoice_role).toBe('purchase');
    expect(byId['rest-a']).toBeUndefined();
    expect(byId['rest-b']).toBeUndefined();
    expect(byId['normal'].invoice_role).toBeNull();
  });

  it('mantém o total de cada mês igual ao modelo antigo e nas agregações do plano', async () => {
    const vault = await loadVault(V);
    expect(vault.totalSpentAmount({ month: 8, year: 2026 })).toBe(42);
    expect(vault.totalSpentAmount({ month: 9, year: 2026 })).toBe(3200);
    expect(vault.totalSpentAmount({ month: 10, year: 2026 })).toBe(500);
    const budget = vault.getBudgetsSummary(9, 2026);
    expect(budget).toEqual([]); // nenhum orçamento cadastrado; categorias abaixo
    const parts = [...vault.transactions.values()].filter(
      (t) => t.isInvoicePart,
    );
    expect(
      parts
        .map((t) => [
          t.sourceTransactionId,
          t.amount,
          t.date.toISOString().slice(0, 10),
        ])
        .sort(),
    ).toEqual([
      ['p-mercado', 1000, '2026-09-10'],
      ['p-posto', 1050, '2026-09-10'],
    ]);
    const remainders = [...vault.transactions.values()].filter(
      (t) => t.isInvoiceRemainder,
    );
    expect(remainders.map((t) => [t.paymentId, t.amount]).sort()).toEqual([
      ['inv-a', 1150],
      ['inv-b', 500],
    ]);

    // O plano lê o banco direto: o mesmo total.
    const repo = new TransactionDrizzleRepository(db as any);
    const sept = await repo.findCommittedByPeriod(V, d(9, 1), d(10, 1));
    expect(
      sept
        .filter((t) => t.type === 'expense')
        .reduce((s, t) => s + t.amount, 0),
    ).toBe(3200);
    const aug = await repo.findCommittedByPeriod(V, d(8, 1), d(9, 1));
    expect(aug.reduce((s, t) => s + t.amount, 0)).toBe(42);

    // Vault 2: o estorno abate a compra; setembro segue somando o pago.
    const v2 = await loadVault(V2);
    expect(v2.totalSpentAmount({ month: 8, year: 2026 })).toBe(0);
    expect(v2.totalSpentAmount({ month: 9, year: 2026 })).toBe(300);
    const v2rows = [...v2.transactions.values()].filter(
      (t) => t.isInvoiceDerived,
    );
    expect(v2rows.map((t) => [t.invoiceRole, t.amount]).sort()).toEqual([
      ['part', 150],
      ['remainder', 150],
    ]);
  });

  it('o que a migração gravou é exatamente o que o domínio recalcularia', async () => {
    for (const id of [V, V2]) {
      const vault = await loadVault(id);
      vault.recomputeAllCards();
      const changes = vault.transactionsTracker.getChanges();
      expect(changes.new, id).toHaveLength(0);
      expect(changes.dirty, id).toHaveLength(0);
      expect(changes.deleted, id).toHaveLength(0);
    }
  });

  it('rodar as migrações de novo não faz nada', async () => {
    await migrate(db, { migrationsFolder: MIGRATIONS });
    const count = (await runSql(`SELECT count(*)::int AS n FROM card_payment`))
      .rows[0];
    expect(count.n).toBe(3);
    const n = (await db.execute(sql`SELECT count(*)::int AS n FROM card`))
      .rows[0];
    expect(n.n).toBe(2);
  });
});
