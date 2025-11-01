/* eslint-disable @typescript-eslint/require-await */
import {
  CategoryRow,
  TransactionRow,
  VaultRow,
} from '@/shared/persistence/sqlite/rows';
import { SQLITE_DATABASE } from '@/shared/persistence/sqlite/sqlite.module';
import { Inject, Injectable } from '@nestjs/common';
import { Database } from 'better-sqlite3';
import { Category } from '../../domain/category';
import { Transaction } from '../../domain/transaction';
import { Vault } from '../../domain/vault';
import { VaultRepository } from '../vault.repository';

@Injectable()
export class VaultSqliteRepository extends VaultRepository {
  constructor(@Inject(SQLITE_DATABASE) private readonly db: Database) {
    super();
  }

  async create(vault: Vault): Promise<void> {
    this.db
      .prepare('INSERT INTO vault (id, token, created_at) VALUES (?, ?, ?)')
      .run(vault.id, vault.token, vault.createdAt.toISOString());
  }

  async update(vault: Vault): Promise<void> {
    const commit = this.db.transaction(() => {
      if (vault.isDirty) {
        this.db
          .prepare('UPDATE vault SET custom_prompt = ? WHERE id = ?')
          .run(vault.getCustomPrompt(), vault.id);
      }

      const transactionsChanges = vault.transactionsTracker.getChanges();
      for (const transaction of transactionsChanges.new) {
        this.db
          .prepare(
            `--sql
            INSERT INTO "transaction" (id, code, amount, type, category_id, vault_id, description, created_at, committed, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            transaction.id,
            transaction.code,
            transaction.amount,
            transaction.type,
            transaction.categoryId ?? null,
            transaction.vaultId,
            transaction.description ?? '',
            transaction.createdAt.toISOString(),
            transaction.isCommitted ? 1 : 0,
            transaction.date.toISOString(),
          );
      }
      for (const transaction of transactionsChanges.deleted) {
        this.db
          .prepare('DELETE FROM "transaction" WHERE vault_id = ? AND id = ?')
          .run(vault.id, transaction.id);
      }

      for (const transaction of transactionsChanges.dirty) {
        this.db
          .prepare(
            'UPDATE "transaction" SET amount = ?, category_id = ?, created_at = ?, description = ?, type = ?, date = ? WHERE vault_id = ? AND id = ?',
          )
          .run(
            transaction.amount,
            transaction.categoryId,
            transaction.createdAt.toISOString(),
            transaction.description,
            transaction.type,
            transaction.date.toISOString(),
            vault.id,
            transaction.id,
          );
      }

      const budgetChanges = vault.budgetsTracker.getChanges();
      for (const budget of budgetChanges.new) {
        this.db
          .prepare(
            'INSERT INTO budget (vault_id, category_id, amount) VALUES (?, ?, ?)',
          )
          .run(vault.id, budget.category.id, budget.amount);
      }
      for (const budget of budgetChanges.deleted) {
        this.db
          .prepare('DELETE FROM budget WHERE vault_id = ? AND category_id = ?')
          .run(vault.id, budget.category.id);
      }
      for (const budget of budgetChanges.dirty) {
        this.db
          .prepare(
            'UPDATE budget SET amount = ? WHERE vault_id = ? AND category_id = ?',
          )
          .run(budget.amount, vault.id, budget.category.id);
      }
      vault.clearChanges();
    });
    commit();
  }

  async findById(id: string): Promise<Vault | null> {
    const row = this.db.prepare('SELECT * FROM vault WHERE id = ?').get(id) as
      | VaultRow
      | undefined;
    if (!row) return null;

    // Load transactions
    const transactionRows = this.db
      .prepare('SELECT * FROM "transaction" WHERE vault_id = ?')
      .all(id) as TransactionRow[];
    const transactions = new Map<string, Transaction>();
    for (const t of transactionRows) {
      transactions.set(
        t.id,
        Transaction.restore({
          id: t.id,
          code: t.code,
          amount: t.amount,
          vaultId: t.vault_id,
          isCommitted: !!t.committed,
          description: t.description,
          createdAt: new Date(t.created_at),
          categoryId: t.category_id,
          type: t.type,
        }),
      );
    }

    // Load budgets
    const budgetRows = this.db
      .prepare('SELECT * FROM budget WHERE vault_id = ?')
      .all(id) as { category_id: string; amount: number }[];
    const budgets = new Map<string, { category: Category; amount: number }>();
    for (const b of budgetRows) {
      // Load category for each budget
      const catRow = this.db
        .prepare('SELECT * FROM category WHERE id = ?')
        .get(b.category_id) as CategoryRow | undefined;
      if (catRow) {
        const category = new Category(
          catRow.id,
          catRow.name,
          catRow.code,
          catRow.description,
          catRow.transaction_type,
        );
        budgets.set(category.id, { category, amount: b.amount });
      }
    }

    const vault = new Vault(
      row.id,
      row.token,
      new Date(row.created_at),
      transactions,
      budgets,
      row.custom_prompt,
    );
    vault.transactionsTracker.clearChanges();
    vault.budgetsTracker.clearChanges();
    return vault;
  }

  async findByToken(token: string): Promise<Vault | null> {
    const row = this.db
      .prepare('SELECT * FROM vault WHERE token = ?')
      .get(token) as VaultRow | undefined;
    if (!row) return null;

    // Load transactions
    const transactionRows = this.db
      .prepare('SELECT * FROM "transaction" WHERE vault_id = ?')
      .all(row.id) as TransactionRow[];
    const transactions = new Map<string, Transaction>();
    for (const t of transactionRows) {
      transactions.set(
        t.id,
        Transaction.restore({
          id: t.id,
          code: t.code,
          amount: t.amount,
          vaultId: t.vault_id,
          isCommitted: !!t.committed,
          description: t.description,
          createdAt: new Date(t.created_at),
          categoryId: t.category_id,
          type: t.type,
        }),
      );
    }

    // Load budgets
    const budgetRows = this.db
      .prepare('SELECT * FROM budget WHERE vault_id = ?')
      .all(row.id) as { category_id: string; amount: number }[];
    const budgets = new Map<string, { category: Category; amount: number }>();
    for (const b of budgetRows) {
      // Load category for each budget
      const catRow = this.db
        .prepare('SELECT * FROM category WHERE id = ?')
        .get(b.category_id) as CategoryRow | undefined;
      if (catRow) {
        const category = new Category(
          catRow.id,
          catRow.name,
          catRow.code,
          catRow.description,
          catRow.transaction_type,
        );
        budgets.set(category.id, { category, amount: b.amount });
      }
    }

    const vault = new Vault(
      row.id,
      row.token,
      new Date(row.created_at),
      transactions,
      budgets,
    );
    vault.transactionsTracker.clearChanges();
    vault.budgetsTracker.clearChanges();
    return vault;
  }
}
