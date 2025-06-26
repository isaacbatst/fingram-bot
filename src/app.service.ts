import { Injectable } from '@nestjs/common';
import { Vault } from './domain/vault';
import { VaultRepository } from './repositories/vault.repository';
import { ChatRepository } from './repositories/chat.repository';
import { Chat } from './domain/chat';
import { left, right } from './domain/either';
import { Transaction } from './domain/transaction';

@Injectable()
export class AppService {
  constructor(
    private vaultRepository: VaultRepository,
    private chatRepository: ChatRepository,
  ) {}

  async createVault(input: { chatId: string }) {
    const vault = Vault.create();
    let chat = await this.chatRepository.findByTelegramChatId(input.chatId);
    if (!chat) {
      chat = Chat.create({ telegramChatId: input.chatId, vaultId: vault.id });
    }
    await this.vaultRepository.create(vault);
    await this.chatRepository.upsert(chat);
    return `Cofre criado! Use /add para adicionar transações.`;
  }

  async getVault(input: { chatId: string }) {
    const chat = await this.chatRepository.findByTelegramChatId(input.chatId);
    if (!chat) {
      return left(`Cofre não inicializado nessa conversa`);
    }
    if (!chat.vaultId) {
      return left(
        `Essa conversa não possui um cofre associado. Crie um cofre primeiro.`,
      );
    }
    const vault = await this.vaultRepository.findById(chat.vaultId);
    if (!vault) {
      return left(`Cofre da conversa não encontrado`);
    }
    return right(vault);
  }

  async joinVault(input: { chatId: string; vaultToken: string }) {
    const vault = await this.vaultRepository.findByToken(input.vaultToken);
    if (!vault) {
      return left(`Cofre não encontrado`);
    }
    let chat = await this.chatRepository.findByTelegramChatId(input.chatId);
    if (!chat) {
      chat = Chat.create({ telegramChatId: input.chatId, vaultId: vault.id });
    } else {
      chat.vaultId = vault.id;
    }
    await this.chatRepository.upsert(chat);
    return right(
      `Você está associado ao novo cofre. Use /add para adicionar transações.`,
    );
  }

  async addTransactionToVault(input: {
    chatId: string;
    transaction: {
      amount: number;
      description?: string;
      shouldCommit?: boolean;
    };
  }) {
    const chat = await this.chatRepository.findByTelegramChatId(input.chatId);
    if (!chat) {
      return left(`Cofre não inicializado nessa conversa`);
    }
    if (!chat.vaultId) {
      return left(
        `Essa conversa não possui um cofre associado. Crie um cofre primeiro.`,
      );
    }
    const vault = await this.vaultRepository.findById(chat.vaultId);
    if (!vault) {
      return left(`Cofre da conversa não encontrado`);
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
    return right(
      `Transação #${transaction.code} adicionada com sucesso!\nSeu saldo atual é: ${vault.getBalance()}`,
    );
  }

  async editTransactionInVault(input: {
    chatId: string;
    transactionCode: string;
    newAmount: number;
  }) {
    const chat = await this.chatRepository.findByTelegramChatId(input.chatId);
    if (!chat) {
      return left(`Cofre não inicializado nessa conversa`);
    }
    if (!chat.vaultId) {
      return left(
        `Essa conversa não possui um cofre associado. Crie um cofre primeiro.`,
      );
    }
    const vault = await this.vaultRepository.findById(chat.vaultId);
    if (!vault) {
      return left(`Cofre da conversa não encontrado`);
    }

    const [err] = vault.editTransaction(input.transactionCode, input.newAmount);
    if (err !== null) {
      return left(err);
    }
    await this.vaultRepository.update(vault);
    return right(
      `Transação #${input.transactionCode} editada com sucesso!\nSeu saldo atual é: ${vault.getBalance()}`,
    );
  }
}
