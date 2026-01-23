import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Chat } from '../../domain/chat';
import { ChatRepository } from '../chat.repository';
import {
  DRIZZLE_DATABASE,
  DrizzleDatabase,
} from '@/shared/persistence/drizzle/drizzle.module';
import { chat } from '@/shared/persistence/drizzle/schema';

@Injectable()
export class ChatDrizzleRepository extends ChatRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDatabase) {
    super();
  }

  async upsert(chatEntity: Chat): Promise<void> {
    await this.db
      .insert(chat)
      .values({
        id: chatEntity.id,
        telegramChatId: chatEntity.telegramChatId,
        vaultId: chatEntity.vaultId,
      })
      .onConflictDoUpdate({
        target: chat.id,
        set: {
          telegramChatId: chatEntity.telegramChatId,
          vaultId: chatEntity.vaultId,
        },
      });
  }

  async findByTelegramChatId(id: string): Promise<Chat | null> {
    const rows = await this.db
      .select()
      .from(chat)
      .where(eq(chat.telegramChatId, id));
    if (rows.length === 0) return null;
    const row = rows[0];
    return new Chat(row.id, row.telegramChatId, row.vaultId);
  }

  async findByVaultId(id: string): Promise<Chat[]> {
    const rows = await this.db
      .select()
      .from(chat)
      .where(eq(chat.vaultId, id));
    return rows.map((row) => new Chat(row.id, row.telegramChatId, row.vaultId));
  }
}
