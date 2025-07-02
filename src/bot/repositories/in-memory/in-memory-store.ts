import { Chat } from '@/bot/domain/chat';

export class InMemoryStore {
  chats: Map<string, Chat> = new Map();
}
