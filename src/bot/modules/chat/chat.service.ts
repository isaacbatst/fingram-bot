import { Injectable } from '@nestjs/common';
import { ChatRepository } from './repositories/chat.repository';
import { Chat } from './domain/chat';

@Injectable()
export class ChatService {
  constructor(private readonly chatRepository: ChatRepository) {}
  async upsertChat(input: { telegramChatId: string; vaultId: string }) {
    let chat = await this.chatRepository.findByTelegramChatId(
      input.telegramChatId,
    );
    if (!chat) {
      chat = Chat.create({
        telegramChatId: input.telegramChatId,
        vaultId: input.vaultId,
      });
    }
    await this.chatRepository.upsert(chat);
    return chat;
  }

  async findChatByTelegramChatId(telegramChatId: string) {
    return this.chatRepository.findByTelegramChatId(telegramChatId);
  }

  async findChatsByVaultId(vaultId: string) {
    return this.chatRepository.findByVaultId(vaultId);
  }

  async joinVault(input: { chatId: string; vaultId: string }) {
    let chat = await this.chatRepository.findByTelegramChatId(input.chatId);
    if (!chat) {
      chat = Chat.create({
        telegramChatId: input.chatId,
        vaultId: input.vaultId,
      });
    } else {
      chat.vaultId = input.vaultId;
    }
    await this.chatRepository.upsert(chat);
  }
}
