import { Database } from 'better-sqlite3';
import { CATEGORIES_SEED } from '../seed';

export class MigrationService {
  static migrate(db: Database): void {
    db.exec(`--sql
      CREATE TABLE IF NOT EXISTS category (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        description TEXT DEFAULT '',
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense', 'both'))
      );

      CREATE TABLE IF NOT EXISTS vault (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        custom_prompt TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        budget_start_day INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS chat (
        id TEXT PRIMARY KEY,
        telegram_chat_id TEXT NOT NULL,
        vault_id TEXT,
        FOREIGN KEY (vault_id) REFERENCES vault(id)
      );

      CREATE TABLE IF NOT EXISTS "transaction" (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        category_id TEXT,
        vault_id TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        committed INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (category_id) REFERENCES category(id),
        FOREIGN KEY (vault_id) REFERENCES vault(id)
      );

      CREATE TABLE IF NOT EXISTS budget (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        amount REAL NOT NULL,
        FOREIGN KEY (vault_id) REFERENCES vault(id),
        FOREIGN KEY (category_id) REFERENCES category(id)
      );

      CREATE TABLE IF NOT EXISTS action (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
        payload JSON NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'executed', 'failed', 'cancelled'))
      );

      CREATE TABLE IF NOT EXISTS vault_category (
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL,
        base_category_id TEXT,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        description TEXT DEFAULT '',
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense', 'both')),
        FOREIGN KEY (vault_id) REFERENCES vault(id),
        FOREIGN KEY (base_category_id) REFERENCES category(id)
      );
    `);

    const hasDateColumn = db
      .prepare(
        `
      SELECT 1 FROM pragma_table_info('transaction') WHERE name='date'
    `,
      )
      .get();

    if (!hasDateColumn) {
      db.exec(`
        ALTER TABLE "transaction" ADD COLUMN date TEXT;
        UPDATE "transaction" SET date = created_at WHERE date IS NULL OR date = '';
      `);
    }

    // Migration: Add budget_start_day column to vault table
    const hasBudgetStartDayColumn = db
      .prepare(
        `
      SELECT 1 FROM pragma_table_info('vault') WHERE name='budget_start_day'
    `,
      )
      .get();

    if (!hasBudgetStartDayColumn) {
      db.exec(`
        ALTER TABLE vault ADD COLUMN budget_start_day INTEGER NOT NULL DEFAULT 1;
      `);
    }
  }

  static seed(db: Database): void {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO category (id, name, code, description, transaction_type)
       VALUES (@id, @name, @code, @description, @transaction_type)`,
    );

    for (const category of CATEGORIES_SEED) {
      stmt.run(category);
    }
  }
}
