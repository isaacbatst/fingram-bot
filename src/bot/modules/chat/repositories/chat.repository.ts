import { Chat } from '../domain/chat';

export abstract class ChatRepository {
  abstract upsert(chat: Chat): Promise<void>;
  abstract findByTelegramChatId(id: string): Promise<Chat | null>;
}
