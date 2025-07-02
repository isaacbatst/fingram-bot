import { Injectable } from '@nestjs/common';
import { Chat } from '../../domain/chat';
import { ChatRepository } from '../chat.repository';
import { InMemoryStore } from './in-memory-store';

@Injectable()
export class ChatInMemoryRepository extends ChatRepository {
  constructor(private store: InMemoryStore) {
    super();
  }
  upsert(chat: Chat): Promise<void> {
    this.store.chats.set(chat.id, chat);
    return Promise.resolve();
  }

  findByTelegramChatId(id: string): Promise<Chat | null> {
    const chat = Array.from(this.store.chats.values()).find(
      (chat) => chat.telegramChatId === id,
    );
    return Promise.resolve(chat ?? null);
  }
}
