import { Injectable } from '@nestjs/common';
import { AiService } from './ai/ai.service';
import { ActionType } from './domain/action';
import { Chat } from './domain/chat';
import { left, right } from './domain/either';
import { Transaction } from './domain/transaction';
import { Vault } from './domain/vault';
import { ActionRepository } from './repositories/action.repository';
import { ChatRepository } from './repositories/chat.repository';
import { VaultRepository } from './repositories/vault.repository';

@Injectable()
export class AppService {
  constructor(
    private vaultRepository: VaultRepository,
    private chatRepository: ChatRepository,
    private actionRepository: ActionRepository,
    private aiService: AiService,
  ) {}

  async parseVaultAction(input: { message: string; chatId: string }) {
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
    const [err, action] = await this.aiService.parseVaultAction(input.message);
    if (err !== null) {
      return left(err);
    }

    await this.actionRepository.create(action);
    return right(action);
  }

  async handleVaultAction(input: { actionId: string; chatId: string }) {
    const action = await this.actionRepository.findById(input.actionId);
    if (!action) {
      return left(`Ação não encontrada`);
    }
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

    switch (action.type) {
      case ActionType.INCOME:
        return await this.addTransactionToVault({
          chatId: input.chatId,
          transaction: {
            amount: action.payload.amount,
            description: action.payload.description,
            shouldCommit: true,
          },
        });
        break;
      case ActionType.EXPENSE:
        return await this.addTransactionToVault({
          chatId: input.chatId,
          transaction: {
            amount: -action.payload.amount,
            description: action.payload.description,
            shouldCommit: true,
          },
        });
        break;
      default:
        return left(`Ação desconhecida`);
    }
  }

  async createVault(input: { chatId: string }) {
    const vault = Vault.create();
    let chat = await this.chatRepository.findByTelegramChatId(input.chatId);
    if (!chat) {
      chat = Chat.create({ telegramChatId: input.chatId, vaultId: vault.id });
    }
    await this.vaultRepository.create(vault);
    await this.chatRepository.upsert(chat);
    return vault;
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
    return right(vault);
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
    return right({
      transaction,
      vault,
    });
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

    const [err, transaction] = vault.editTransaction(
      input.transactionCode,
      input.newAmount,
    );
    if (err !== null) {
      return left(err);
    }
    await this.vaultRepository.update(vault);
    return right({
      transaction,
      vault,
    });
  }
}
