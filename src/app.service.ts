import { Injectable } from '@nestjs/common';
import { ReadableStream } from 'node:stream/web';
import { AiService } from './ai/ai.service';
import { Action, ActionStatus, ActionType } from './domain/action';
import { Chat } from './domain/chat';
import { left, right } from './domain/either';
import { Transaction } from './domain/transaction';
import { Vault } from './domain/vault';
import { ActionRepository } from './repositories/action.repository';
import { CategoryRepository } from './repositories/category.repository';
import { ChatRepository } from './repositories/chat.repository';
import { VaultRepository } from './repositories/vault.repository';
import { CsvParser } from './shared/csv-parser';

@Injectable()
export class AppService {
  constructor(
    private vaultRepository: VaultRepository,
    private chatRepository: ChatRepository,
    private actionRepository: ActionRepository,
    private categoryRepository: CategoryRepository,
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
    const categories = await this.categoryRepository.findAll();
    const [err, action] = await this.aiService.parseVaultAction(
      input.message,
      categories,
    );
    if (err !== null) {
      return left(err);
    }

    await this.actionRepository.upsert(action);
    return right({
      ...action,
      payload: {
        ...action.payload,
        categoryName: categories.find(
          (cat) => cat.id === action.payload.categoryId,
        )?.name,
        categoryCode: categories.find(
          (cat) => cat.id === action.payload.categoryId,
        )?.code,
      },
    });
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
    console.log('action', action);
    switch (action.type) {
      case ActionType.INCOME:
        return this.handleIncomeAction({ action, input });
      case ActionType.EXPENSE:
        return this.handleExpenseAction({ action, input });
      default:
        return left(`Ação desconhecida`);
    }
  }

  private async handleIncomeAction(params: {
    action: Action;
    input: { chatId: string; actionId: string };
  }) {
    const { action, input } = params;
    const result = await this.addTransactionToVault({
      chatId: input.chatId,
      transaction: {
        amount: action.payload.amount,
        description: action.payload.description,
        categoryId: action.payload.categoryId,
        shouldCommit: true,
        type: 'income',
      },
    });

    if (result[0]) {
      action.status = ActionStatus.FAILED;
    }

    if (result[1]) {
      action.status = ActionStatus.EXECUTED;
    }

    await this.actionRepository.upsert(action);
    return result;
  }

  private async handleExpenseAction(params: {
    action: Action;
    input: { chatId: string; actionId: string };
  }) {
    const { action, input } = params;
    const result = await this.addTransactionToVault({
      chatId: input.chatId,
      transaction: {
        amount: action.payload.amount,
        description: action.payload.description,
        categoryId: action.payload.categoryId,
        shouldCommit: true,
        type: 'expense',
      },
    });

    if (result[0]) {
      action.status = ActionStatus.FAILED;
    }

    if (result[1]) {
      action.status = ActionStatus.EXECUTED;
    }

    await this.actionRepository.upsert(action);
    return result;
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

  async getTransactions(input: {
    chatId: string;
    date?: {
      day?: number;
      month: number;
      year: number;
    };
    page?: number;
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
    const transactions = await this.vaultRepository.findTransactionsByVaultId(
      chat.vaultId,
      {
        date: input.date ?? {
          month: new Date().getMonth() + 1, // Default to current month
          year: new Date().getFullYear(), // Default to current year
        },
        page: input.page ?? 1,
        pageSize: 5, // Default page size
      },
    );

    return right(transactions);
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
      categoryId?: string;
      shouldCommit?: boolean;
      type: 'expense' | 'income';
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

    const category = input.transaction.categoryId
      ? await this.categoryRepository.findById(input.transaction.categoryId)
      : null;

    const transaction = Transaction.create({
      amount: input.transaction.amount,
      description: input.transaction.description,
      categoryId: input.transaction.categoryId,
      type: input.transaction.type,
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
      transaction: {
        ...transaction,
        categoryName: category ? category.name : null,
        categoryCode: category ? category.code : null,
      },
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

  async getCategories() {
    const categories = await this.categoryRepository.findAll();
    return categories;
  }

  async setBudgets(input: {
    chatId: string;
    budgets: { categoryCode: string; amount: number }[];
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
    const categories = await this.categoryRepository.findAll();

    for (const budget of input.budgets) {
      const category = categories.find(
        (cat) => cat.code === budget.categoryCode,
      );
      if (!category) {
        console.warn(
          `Categoria com código ${budget.categoryCode} não encontrada. Ignorando o orçamento.`,
        );
        continue;
      }
      const [err] = vault.setBudget(category, budget.amount);
      if (err !== null) {
        return left(err);
      }
    }

    await this.vaultRepository.update(vault);
    return right(vault);
  }

  async processTransactionsFile(input: { chatId: string; fileUrl: string }) {
    console.log(
      `[processTransactionsFile] Start processing file for chatId: ${input.chatId}, fileUrl: ${input.fileUrl}`,
    );
    const chat = await this.chatRepository.findByTelegramChatId(input.chatId);
    if (!chat) {
      console.warn(
        `[processTransactionsFile] Chat not found for chatId: ${input.chatId}`,
      );
      return left(`Cofre não inicializado nessa conversa`);
    }
    if (!chat.vaultId) {
      console.warn(
        `[processTransactionsFile] No vault associated with chatId: ${input.chatId}`,
      );
      return left(
        `Essa conversa não possui um cofre associado. Crie um cofre primeiro.`,
      );
    }
    const vault = await this.vaultRepository.findById(chat.vaultId);
    if (!vault) {
      console.warn(
        `[processTransactionsFile] Vault not found for vaultId: ${chat.vaultId}`,
      );
      return left(`Cofre da conversa não encontrado`);
    }
    console.log(
      `[processTransactionsFile] Fetching file from URL: ${input.fileUrl}`,
    );
    const response = await fetch(input.fileUrl);
    if (!response.body) {
      console.error(
        `[processTransactionsFile] Failed to fetch file from URL: ${input.fileUrl}`,
      );
      return left(`Erro ao buscar arquivo: ${input.fileUrl}`);
    }
    const categories = await this.categoryRepository.findAll();
    console.log(
      `[processTransactionsFile] Parsing transactions file with AI service`,
    );
    const transactions = (
      await CsvParser.parse(response.body as ReadableStream)
    ).map((row) => {
      const [date, value, _id, description] = row;
      const amount = parseFloat(value);
      // Parse date from "dd/mm/yyyy"
      const [day, month, year] = date.split('/').map(Number);
      const parsedDate = new Date(year, month - 1, day);
      return Transaction.create({
        amount: Math.abs(amount),
        description: description || '',
        date: parsedDate,
        type: amount >= 0 ? 'income' : 'expense',
        categoryId: null,
      });
    });

    console.log(
      `[processTransactionsFile] CSV data parsed successfully, length: ${transactions.length}`,
    );
    const [err, parsedCategories] = await this.aiService.parseTransactionsFile(
      transactions,
      categories,
    );

    if (err !== null) {
      console.error(
        `[processTransactionsFile] Error parsing transactions file: ${err}`,
      );
      return left(`Erro ao processar transações: ${err}`);
    }

    transactions.forEach((transaction) => {
      console.log(
        `[processTransactionsFile] Assigning categoryId ${parsedCategories.get(transaction.id)} for transaction: ${transaction.id}`,
      );
      transaction.categoryId = parsedCategories.get(transaction.id) || null;
    });

    for (const transaction of transactions) {
      vault.addTransaction(transaction);
      const [commitErr] = vault.commitTransaction(transaction.id);
      if (commitErr !== null) {
        console.error(
          `[processTransactionsFile] Error committing transaction: ${commitErr}`,
        );
        continue;
      }
      console.log(
        `[processTransactionsFile] Transaction committed: ${transaction.id}`,
      );
    }
    await this.vaultRepository.update(vault);
    console.log(
      `[processTransactionsFile] Vault updated successfully for vaultId: ${vault.id}`,
    );
    return right(vault);
  }
}
