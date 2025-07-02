import { Database } from 'better-sqlite3';

export class MigrationService {
  static run(db: Database): void {
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
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat (
        id TEXT PRIMARY KEY,
        telegram_chat_id TEXT NOT NULL,
        vault_id TEXT,
        FOREIGN KEY (vault_id) REFERENCES vault(id)
      );

      CREATE TABLE IF NOT EXISTS transaction (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        category_id TEXT,
        created_at TEXT NOT NULL,
        committed INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (category_id) REFERENCES category(id)
      );

      CREATE TABLE IF NOT EXISTS vault_entry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        FOREIGN KEY (vault_id) REFERENCES vault(id),
        FOREIGN KEY (transaction_id) REFERENCES transaction(id)
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
        amount REAL NOT NULL,
        description TEXT,
        category_id TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'executed', 'failed', 'cancelled')),
        FOREIGN KEY (category_id) REFERENCES category(id)
      );
    `);
  }
}
