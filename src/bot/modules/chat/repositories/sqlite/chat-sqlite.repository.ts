/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Inject } from '@nestjs/common';
import { Chat } from '../../domain/chat';
import { ChatRepository } from '../chat.repository';
import { SQLITE_DATABASE } from '@/shared/persistence/sqlite/sqlite.module';
import { Database } from 'better-sqlite3';
import { ChatRow } from '@/shared/persistence/sqlite/rows';

@Injectable()
export class ChatSqliteRepository extends ChatRepository {
  constructor(@Inject(SQLITE_DATABASE) private readonly db: Database) {
    super();
  }

  async upsert(chat: Chat): Promise<void> {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO chat (id, telegram_chat_id, vault_id) VALUES (?, ?, ?)',
      )
      .run(chat.id, chat.telegramChatId, chat.vaultId);
  }

  async findByTelegramChatId(id: string): Promise<Chat | null> {
    const row = this.db
      .prepare('SELECT * FROM chat WHERE telegram_chat_id = ?')
      .get(id) as ChatRow | undefined;
    if (!row) return null;
    return new Chat(row.id, row.telegram_chat_id, row.vault_id);
  }
}
