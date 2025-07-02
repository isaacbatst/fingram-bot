import { VaultService } from '@/vault/vault.service';
import { Injectable } from '@nestjs/common';
import { left, right } from '../vault/domain/either';
import { ChatService } from './chat.service';

@Injectable()
export class BotService {
  private static readonly NOT_STARTED_MESSAGE =
    'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.';

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
    if (!chat.vaultId) return left(BotService.NOT_STARTED_MESSAGE);
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
    if (!chat.vaultId) return left(BotService.NOT_STARTED_MESSAGE);
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
    if (args.length < 1) {
      return left(
        'Uso: /edit <código> [-v valor] [-d dd/mm/yyyy] [-c categoria] [-desc "descrição"]',
      );
    }
    const code = args[0];
    // Parse flags: -v value -d dd/mm/yyyy -c categoryCode -desc "description with spaces"
    const flags = args.slice(1);
    let newAmount: number | undefined;
    let newDate: Date | undefined;
    let newCategory: string | undefined;
    let newDescription: string | undefined;

    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      if (flag === '-v' && flags[i + 1]) {
        const value = parseFloat(flags[i + 1]);
        if (isNaN(value)) return left('Valor inválido para -v. Use um número.');
        newAmount = value;
        i++;
      } else if (flag === '-d' && flags[i + 1]) {
        // Accept date as dd/mm/yyyy
        const dateParts = flags[i + 1].split('/');
        if (dateParts.length === 3) {
          const [day, month, year] = dateParts.map(Number);
          if (
            !isNaN(day) &&
            !isNaN(month) &&
            !isNaN(year) &&
            day > 0 &&
            month > 0 &&
            year > 0
          ) {
            newDate = new Date(year, month - 1, day);
          } else {
            return left('Data inválida para -d. Use dd/mm/yyyy.');
          }
        } else {
          return left('Data inválida para -d. Use dd/mm/yyyy.');
        }
        i++;
      } else if (flag === '-c' && flags[i + 1]) {
        newCategory = flags[i + 1];
        i++;
      } else if (flag === '-desc' && flags[i + 1]) {
        newDescription = flags[i + 1];
        // If description is quoted, join until closing quote
        if (newDescription.startsWith('"')) {
          let desc = newDescription;
          let j = i + 2;
          while (!desc.endsWith('"') && j < flags.length) {
            desc += ' ' + flags[j];
            j++;
          }
          newDescription = desc.replace(/^"|"$/g, '');
          i = j - 1;
        }
      }
    }

    if (
      newAmount === undefined &&
      newDate === undefined &&
      newCategory === undefined &&
      newDescription === undefined
    ) {
      return left(
        'Nenhum campo para editar informado. Use -v, -d, -c ou -desc.',
      );
    }

    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId) return left(BotService.NOT_STARTED_MESSAGE);
    return await this.vaultService.editTransactionInVault({
      vaultId: chat.vaultId,
      transactionCode: code,
      newAmount,
      date: newDate,
      categoryCode: newCategory,
      description: newDescription,
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
    if (!chat.vaultId) return left(BotService.NOT_STARTED_MESSAGE);
    return await this.vaultService.setBudgets({
      vaultId: chat.vaultId,
      budgets,
    });
  }

  async handleSummary(chatId: string) {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId) return left(BotService.NOT_STARTED_MESSAGE);
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
    if (!chat.vaultId) return left(BotService.NOT_STARTED_MESSAGE);
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
    if (!chat.vaultId) return left(BotService.NOT_STARTED_MESSAGE);
    return await this.vaultService.processTransactionsFile({
      vaultId: chat.vaultId,
      fileUrl,
    });
  }

  async parseVaultAction(input: { chatId: string; message: string }) {
    const chat = await this.chatService.findChatByTelegramChatId(input.chatId);
    if (!chat || !chat.vaultId) {
      return left(BotService.NOT_STARTED_MESSAGE);
    }
    return this.vaultService.parseVaultAction({
      message: input.message,
      vaultId: chat.vaultId,
    });
  }

  async handleVaultAction(input: { actionId: string; chatId: string }) {
    const chat = await this.chatService.findChatByTelegramChatId(input.chatId);
    if (!chat || !chat.vaultId) {
      return left(BotService.NOT_STARTED_MESSAGE);
    }
    return this.vaultService.handleVaultAction({
      actionId: input.actionId,
      vaultId: chat.vaultId,
    });
  }
}
