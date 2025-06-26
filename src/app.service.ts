import { Injectable } from '@nestjs/common';
import { Vault } from './domain/vault';
import { VaultRepository } from './repositories/vault.repository';
import { ChatRepository } from './repositories/chat.repository';
import { Chat } from './domain/chat';
import { left } from './domain/either';
import { Transaction } from './domain/transaction';

@Injectable()
export class AppService {
  constructor(
    private vaultRepository: VaultRepository,
    private chatRepository: ChatRepository,
  ) {}

  async createVault(input: {
    chatId: string;
    users: {
      id: string;
      name: string;
    }[];
  }) {
    const vault = Vault.create({ users: input.users });
    let chat = await this.chatRepository.findById(input.chatId);
    if (!chat) {
      chat = Chat.create({ telegramChatId: input.chatId, vaultId: vault.id });
    }
    await this.vaultRepository.create(vault);
    await this.chatRepository.upsert(chat);
    return vault;
  }

  async addTransactionToVault(input: {
    chatId: string;
    transaction: {
      amount: number;
      description?: string;
      shouldCommit?: boolean;
    };
  }) {
    const chat = await this.chatRepository.findById(input.chatId);
    if (!chat) {
      return left(`Chat with id ${input.chatId} not found`);
    }
    if (!chat.vaultId) {
      return left(
        `Chat with id ${input.chatId} does not have an associated vault`,
      );
    }
    const vault = await this.vaultRepository.findById(chat.vaultId);
    if (!vault) {
      return left(`Vault with id ${chat.vaultId} not found`);
    }

    const transaction = Transaction.create({
      amount: input.transaction.amount,
      description: input.transaction.description,
    });
    vault.addTransaction(transaction);
    if (input.transaction.shouldCommit) {
      const [err] = vault.commitTransaction(transaction.id);
      if (err !== null) {
        return left(err);
      }
    }
    await this.vaultRepository.update(vault);
  }

  async editTransactionInVault(input: {
    chatId: string;
    transactionId: string;
    newAmount: number;
  }) {
    const chat = await this.chatRepository.findById(input.chatId);
    if (!chat) {
      return left(`Chat with id ${input.chatId} not found`);
    }
    if (!chat.vaultId) {
      return left(
        `Chat with id ${input.chatId} does not have an associated vault`,
      );
    }
    const vault = await this.vaultRepository.findById(chat.vaultId);
    if (!vault) {
      return left(`Vault with id ${chat.vaultId} not found`);
    }

    const [err] = vault.editTransaction(input.transactionId, input.newAmount);
    if (err !== null) {
      return left(err);
    }
    await this.vaultRepository.update(vault);
  }
}
