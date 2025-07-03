import { Database } from 'better-sqlite3';

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
        payload JSON NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'executed', 'failed', 'cancelled')),
      );
    `);
  }

  static seed(db: Database): void {
    const categories = [
      {
        id: 'f00110c1-fd2f-42d2-b579-8cc337668d82',
        name: '🏡 Moradia',
        code: '1',
        description:
          'aluguel, condomínio, contas de casa como luz, água, internet, gás, manutenção',
        transaction_type: 'expense',
      },
      {
        id: 'a29eb76c-0def-43ef-9c21-95928616e6f5',
        name: '🛒 Compras',
        code: '2',
        description:
          'supermercado, alimentação, higiene, farmácia, pequenas compras',
        transaction_type: 'expense',
      },
      {
        id: 'f2662cda-938f-4af6-8fcc-b9d6b7bfc061',
        name: '🚗 Transporte',
        code: '3',
        description: 'combustível, manutenção, uber, ônibus, estacionamento',
        transaction_type: 'expense',
      },
      {
        id: '9854990d-b348-4572-a077-dd4710cc9973',
        name: '🎓 Educação',
        code: '4',
        description: 'mensalidade, material escolar, cursos, livros',
        transaction_type: 'expense',
      },
      {
        id: '2d865bfa-84a3-4b06-9ac0-23bb50439954',
        name: '🏥 Saúde',
        code: '5',
        description: 'remédios, consultas, exames, plano de saúde',
        transaction_type: 'expense',
      },
      {
        id: 'c5d35a1b-5d61-4412-9083-52bd9468fbe5',
        name: '🎉 Lazer',
        code: '6',
        description: 'cinema, streaming, hobbies, bares, festas, games',
        transaction_type: 'expense',
      },
      {
        id: '206b9595-4929-4cc9-8bd9-8ec2aa73a27a',
        name: '💰 Investimentos',
        code: '7',
        description: 'poupança, aplicações, aportes',
        transaction_type: 'expense',
      },
      {
        id: '3562366d-861c-46de-a1f3-2d468134ec7f',
        name: '👪 Família & Pets',
        code: '8',
        description: 'filhos, pets, cuidados com parentes',
        transaction_type: 'expense',
      },
      {
        id: 'ee5bc836-ca4c-432e-afeb-fc8728f54350',
        name: '🎁 Presentes/Extras',
        code: '9',
        description: 'presentes, datas especiais, doações, imprevistos',
        transaction_type: 'expense',
      },
      {
        id: 'd9837314-2262-4ff1-a74c-a1a64deedd34',
        name: 'Outros',
        code: '10',
        description: 'Despesas diversas não categorizadas',
        transaction_type: 'both',
      },
      {
        id: 'd17708cd-dac1-4b3f-a647-c79840d67ee5',
        name: '💼 Trabalho',
        code: '11',
        description: 'salário, freelas, bônus, comissões',
        transaction_type: 'income',
      },
    ];

    const stmt = db.prepare(
      `INSERT OR IGNORE INTO category (id, name, code, description, transaction_type)
       VALUES (@id, @name, @code, @description, @transaction_type)`,
    );

    for (const category of categories) {
      stmt.run(category);
    }
  }
}
