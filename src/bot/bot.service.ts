import { Injectable } from '@nestjs/common';
import { VaultService } from '@/vault/vault.service';
import { ChatService } from './chat.service';
import { left, right, Either } from '../vault/domain/either';

@Injectable()
export class BotService {
  constructor(
    private readonly chatService: ChatService,
    private readonly vaultService: VaultService,
  ) {}

  async handleCreate(chatId: string) {
    const vault = await this.vaultService.createVault();
    await this.chatService.upsertChat({
      telegramChatId: chatId,
      vaultId: vault.id,
    });
    return { vault };
  }

  async handleJoin(chatId: string, token: string) {
    if (!token) {
      return left('Uso: /join <token>');
    }
    const vault = await this.vaultService.findByToken(token);
    if (!vault) {
      return left('Cofre não encontrado ou token inválido.');
    }
    await this.chatService.joinVault({ chatId, vaultId: vault.id });
    return right({ vault });
  }

  async handleIncome(chatId: string, args: string[]) {
    if (args.length < 1) {
      return left('Uso: /income <quantia> [descrição]');
    }
    const amount = parseFloat(args[0]);
    if (isNaN(amount)) {
      return left('Quantia inválida. Use um número.');
    }
    const description = args.slice(1).join(' ') || undefined;
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId)
      return left(
        'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.',
      );
    return await this.vaultService.addTransactionToVault({
      vaultId: chat.vaultId,
      transaction: {
        amount,
        description,
        shouldCommit: true,
        type: 'income',
      },
    });
  }

  async handleExpense(chatId: string, args: string[]) {
    if (args.length < 1) {
      return left('Uso: /expense <quantia> [descrição]');
    }
    const amount = parseFloat(args[0]);
    if (isNaN(amount)) {
      return left('Quantia inválida. Use um número.');
    }
    const description = args.slice(1).join(' ') || undefined;
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId)
      return left(
        'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.',
      );
    return await this.vaultService.addTransactionToVault({
      vaultId: chat.vaultId,
      transaction: {
        amount: -Math.abs(amount),
        description,
        shouldCommit: true,
        type: 'expense',
      },
    });
  }

  async handleEdit(chatId: string, args: string[]) {
    if (args.length < 2) {
      return left('Uso: /edit <código> <nova quantia>');
    }
    const code = args[0];
    const newAmount = parseFloat(args[1]);
    if (isNaN(newAmount)) {
      return left('Nova quantia inválida. Use um número.');
    }
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId)
      return left(
        'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.',
      );
    return await this.vaultService.editTransactionInVault({
      vaultId: chat.vaultId,
      transactionCode: code,
      newAmount,
    });
  }

  async handleSetBudget(chatId: string, argsText: string) {
    if (!argsText.trim()) {
      return left(
        'Uso: /setbudget <categoria1> <quantia1>, <categoria2> <quantia2> ...',
      );
    }
    const args = argsText
      .trim()
      .split(',')
      .map((arg) => arg.trim());
    const budgets: { categoryCode: string; amount: number }[] = [];
    for (const arg of args) {
      const parts = arg.split(' ');
      if (parts.length !== 2) {
        return left(
          'Formato inválido. Use: /setbudget <categoria1> <quantia1>, <categoria2> <quantia2> ...',
        );
      }
      const categoryCode = parts[0];
      const amount = parseFloat(parts[1]);
      if (isNaN(amount)) {
        return left(
          `Quantia inválida para a categoria ${categoryCode}. Use um número.`,
        );
      }
      budgets.push({ categoryCode, amount });
    }
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId)
      return left(
        'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.',
      );
    return await this.vaultService.setBudgets({
      vaultId: chat.vaultId,
      budgets,
    });
  }

  async handleSummary(chatId: string) {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId)
      return left(
        'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.',
      );
    return await this.vaultService.getVault({ vaultId: chat.vaultId });
  }

  async handleCategories() {
    const categories = await this.vaultService.getCategories();
    return categories;
  }

  async handleTransactions(
    chatId: string,
    parsedArgs: {
      date?: {
        year: number;
        month: number;
        day?: number;
      };
      page: number;
    },
  ) {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId)
      return left(
        'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.',
      );
    return await this.vaultService.getTransactions({
      vaultId: chat.vaultId,
      date: parsedArgs.date,
      page: parsedArgs.page,
      pageSize: 5,
    });
  }

  async handleProcessFile(chatId: string, fileUrl: string) {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId)
      return left(
        'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.',
      );
    return await this.vaultService.processTransactionsFile({
      vaultId: chat.vaultId,
      fileUrl,
    });
  }

  async parseVaultAction(input: { chatId: string; message: string }) {
    const chat = await this.chatService.findChatByTelegramChatId(input.chatId);
    if (!chat || !chat.vaultId) {
      return left(
        'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.',
      );
    }
    return this.vaultService.parseVaultAction({
      message: input.message,
      vaultId: chat.vaultId,
    });
  }

  async handleVaultAction(input: { actionId: string; chatId: string }) {
    const chat = await this.chatService.findChatByTelegramChatId(input.chatId);
    if (!chat || !chat.vaultId) {
      return left(
        'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.',
      );
    }
    return this.vaultService.handleVaultAction({
      actionId: input.actionId,
      vaultId: chat.vaultId,
    });
  }
}
