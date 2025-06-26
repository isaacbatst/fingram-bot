import { Chat } from '../domain/chat';
import { ChatRepository } from './chat.repository';

export class ChatInMemoryRepository extends ChatRepository {
  chats: Map<string, Chat> = new Map();

  upsert(chat: Chat): Promise<void> {
    this.chats.set(chat.id, chat);
    return Promise.resolve();
  }

  findByTelegramChatId(id: string): Promise<Chat | null> {
    const chat = Array.from(this.chats.values()).find(
      (chat) => chat.telegramChatId === id,
    );
    return Promise.resolve(chat ?? null);
  }
}
