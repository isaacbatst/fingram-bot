import { VaultService } from '@/vault/vault.service';
import { Injectable } from '@nestjs/common';
import { Either, left, right } from '../vault/domain/either';
import { ChatService } from './modules/chat/chat.service';

@Injectable()
export class BotService {
  private static readonly NOT_STARTED_MESSAGE =
    'Cofre não inicializado. Use /create para criar um novo cofre ou /join para entrar em um cofre existente.';
  private readonly tokenStore: Map<
    string,
    {
      expiresAt: number;
      chatId: number;
    }
  > = new Map();

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

  /**
   * Registra uma receita no cofre
   * @param chatId ID do chat do Telegram
   * @param params Parâmetros já processados para a receita
   */
  async handleIncome(
    chatId: string,
    params: { amount: number; description?: string },
  ) {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId) return left(BotService.NOT_STARTED_MESSAGE);
    return await this.vaultService.addTransactionToVault({
      vaultId: chat.vaultId,
      transaction: {
        amount: params.amount,
        description: params.description,
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

  /**
   * Edita uma transação existente no cofre
   * @param chatId ID do chat do Telegram
   * @param params Parâmetros já processados para edição da transação
   */
  async handleEdit(
    chatId: string,
    params: {
      transactionCode: string;
      newAmount?: number;
      newDate?: Date;
      newCategory?: string;
      newDescription?: string;
    },
  ) {
    // Validar se pelo menos um campo foi fornecido para edição
    if (
      params.newAmount === undefined &&
      params.newDate === undefined &&
      params.newCategory === undefined &&
      params.newDescription === undefined
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
      transactionCode: params.transactionCode,
      newAmount: params.newAmount,
      date: params.newDate,
      categoryCode: params.newCategory,
      description: params.newDescription,
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

  // accept /summary with optional -d date filter mm/yyyy
  async handleSummary(chatId: string, args: string) {
    const parsedArgs = args.trim().split(' ');
    let date: { year: number; month: number } | undefined;
    if (parsedArgs.length > 0 && parsedArgs[0].startsWith('-d')) {
      const dateArg = parsedArgs[0].substring(2).trim();
      const dateParts = dateArg.split('/');
      if (dateParts.length === 2) {
        const month = parseInt(dateParts[0], 10);
        const year = parseInt(dateParts[1], 10);
        if (!isNaN(month) && !isNaN(year) && month > 0 && year > 0) {
          date = { month, year };
        } else {
          return left('Data inválida. Use -d mm/yyyy.');
        }
      } else {
        return left('Data inválida. Use -d mm/yyyy.');
      }
    } else {
      // Default to current month and year
      const now = new Date();
      date = { month: now.getMonth() + 1, year: now.getFullYear() };
    }
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId) return left(BotService.NOT_STARTED_MESSAGE);
    const [err, vault] = await this.vaultService.getVault({
      vaultId: chat.vaultId,
    });
    if (err !== null) return left(err);
    return right({
      vault: vault.toJSON(),
      budget: vault.getBudgetsSummary(date.month, date.year),
      date,
    });
  }

  async handleCategories() {
    const categories = await this.vaultService.getCategories();
    return categories;
  }

  async getTransactions(
    chatId: string,
    options: {
      categoryId?: string;
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
      date: options.date,
      page: options.page,
      categoryId: options.categoryId,
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

  async editVaultPrompt(chatId: string, customPrompt: string) {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat || !chat.vaultId) {
      return BotService.NOT_STARTED_MESSAGE;
    }
    const [err] = await this.vaultService.editVaultPrompt({
      vaultId: chat.vaultId,
      customPrompt,
    });
    if (err !== null) {
      return left(err);
    }
    return right(`Prompt do cofre atualizado com sucesso:\n\n`);
  }

  async deleteTransaction(
    chatId: string,
    transactionCode: string,
  ): Promise<Either<string, string>> {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) return left('Cofre não encontrado.');
    if (!chat.vaultId) return left(BotService.NOT_STARTED_MESSAGE);
    const [err] = await this.vaultService.deleteTransaction({
      vaultId: chat.vaultId,
      transactionCode,
    });
    if (err !== null) {
      return left(err);
    }
    return right(`Transação ${transactionCode} deletada com sucesso.`);
  }

  async getVaultPrompt(chatId: string) {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat || !chat.vaultId) {
      return left(BotService.NOT_STARTED_MESSAGE);
    }
    return await this.vaultService.getVaultPrompt({ vaultId: chat.vaultId });
  }

  async appendVaultPrompt(chatId: string, appendText: string) {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat || !chat.vaultId) {
      return left(BotService.NOT_STARTED_MESSAGE);
    }
    return await this.vaultService.appendVaultPrompt({
      vaultId: chat.vaultId,
      appendText,
    });
  }

  saveToken(token: string, chatId: number) {
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hora
    this.tokenStore.set(token, { expiresAt, chatId });
  }

  getChatIdFromToken(token: string): number | null {
    const entry = this.tokenStore.get(token);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.chatId;
    }
    return null;
  }
}
