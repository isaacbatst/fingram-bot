import { AiService } from '@/shared/ai/ai.service';
import { CsvParser } from '@/shared/csv-parser';
import { Action, ActionStatus, ActionType } from '@/vault/domain/action';
import { Either, left, right } from '@/vault/domain/either';
import { Transaction } from '@/vault/domain/transaction';
import { ActionRepository } from '@/vault/repositories/action.repository';
import { CategoryRepository } from '@/vault/repositories/category.repository';
import { TransactionRepository } from '@/vault/repositories/transaction.repository';
import { VaultRepository } from '@/vault/repositories/vault.repository';
import { Injectable } from '@nestjs/common';
import { ReadableStream } from 'node:stream/web';
import { Vault } from './domain/vault';
import { TransactionDTO } from './dto/transaction.dto,';

@Injectable()
export class VaultService {
  constructor(
    private vaultRepository: VaultRepository,
    private transactionRepository: TransactionRepository,
    private actionRepository: ActionRepository,
    private categoryRepository: CategoryRepository,
    private aiService: AiService,
  ) {}

  async createVault() {
    const vault = Vault.create();
    await this.vaultRepository.create(vault);
    return vault;
  }

  async parseVaultAction(input: { message: string; vaultId: string }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      return left(`Cofre não encontrado`);
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

  async handleVaultAction(input: { actionId: string; vaultId: string }) {
    const action = await this.actionRepository.findById(input.actionId);
    if (!action) {
      return left(`Ação não encontrada`);
    }
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      return left(`Cofre não encontrado`);
    }
    switch (action.type) {
      case ActionType.INCOME:
        return this.handleIncomeAction({ action, vaultId: input.vaultId });
      case ActionType.EXPENSE:
        return this.handleExpenseAction({ action, vaultId: input.vaultId });
      default:
        return left(`Ação desconhecida`);
    }
  }

  private async handleIncomeAction(params: {
    action: Action;
    vaultId: string;
  }) {
    const { action, vaultId } = params;
    const result = await this.addTransactionToVault({
      vaultId,
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
    vaultId: string;
  }) {
    const { action, vaultId } = params;
    const result = await this.addTransactionToVault({
      vaultId,
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

  async getVault(input: { vaultId: string }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      return left(`Cofre não encontrado`);
    }
    return right(vault);
  }

  async getTransactions(input: {
    vaultId: string;
    date?: {
      day?: number;
      month: number;
      year: number;
    };
    page?: number;
    pageSize?: number;
  }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      return left(`Cofre não encontrado`);
    }
    const transactions =
      await this.transactionRepository.findTransactionsByVaultId(
        input.vaultId,
        {
          date: input.date ?? {
            month: new Date().getMonth() + 1,
            year: new Date().getFullYear(),
          },
          page: input.page ?? 1,
          pageSize: input.pageSize ?? 10,
        },
      );
    return right(transactions);
  }

  async addTransactionToVault(input: {
    vaultId: string;
    transaction: {
      amount: number;
      description?: string;
      categoryId?: string;
      shouldCommit?: boolean;
      type: 'expense' | 'income';
    };
  }): Promise<Either<string, { transaction: TransactionDTO; vault: Vault }>> {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      return left(`Cofre não encontrado`);
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
        category,
      },
      vault,
    });
  }

  async editTransactionInVault(input: {
    vaultId: string;
    transactionCode: string;
    newAmount?: number;
    description?: string;
    categoryCode?: string;
    date?: Date;
  }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      return left(`Cofre não encontrado`);
    }

    let categoryId: string | undefined;
    if (input.categoryCode) {
      const category = await this.categoryRepository.findByCode(
        input.categoryCode,
      );
      if (!category) {
        return left(`Categoria não encontrada`);
      }
      categoryId = category.id;
    }

    const updatedData: {
      amount?: number;
      description?: string;
      categoryId?: string;
      date?: Date;
    } = {};

    if (typeof input.newAmount === 'number')
      updatedData.amount = input.newAmount;
    if (typeof input.description === 'string')
      updatedData.description = input.description;
    if (categoryId) updatedData.categoryId = categoryId;
    if (input.date) updatedData.date = input.date;

    const [err, transaction] = vault.editTransaction(
      input.transactionCode,
      updatedData,
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
    vaultId: string;
    budgets: { categoryCode: string; amount: number }[];
  }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      return left(`Cofre não encontrado`);
    }
    const categories = await this.categoryRepository.findAll();
    for (const budget of input.budgets) {
      const category = categories.find(
        (cat) => cat.code === budget.categoryCode,
      );
      if (!category) {
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

  async processTransactionsFile(input: { vaultId: string; fileUrl: string }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      return left(`Cofre não encontrado`);
    }
    const response = await fetch(input.fileUrl);
    if (!response.body) {
      return left(`Erro ao buscar arquivo: ${input.fileUrl}`);
    }
    const categories = await this.categoryRepository.findAll();
    const transactions = (
      await CsvParser.parse(response.body as ReadableStream)
    ).map((row) => {
      const [date, value, _id, description] = row;
      const amount = parseFloat(value);
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
    const [err, parsedCategories] = await this.aiService.parseTransactionsFile(
      transactions,
      categories,
    );
    if (err !== null) {
      return left(`Erro ao processar transações: ${err}`);
    }
    transactions.forEach((transaction) => {
      transaction.categoryId = parsedCategories.get(transaction.id) || null;
    });
    for (const transaction of transactions) {
      vault.addTransaction(transaction);
      const [commitErr] = vault.commitTransaction(transaction.id);
      if (commitErr !== null) {
        continue;
      }
    }
    await this.vaultRepository.update(vault);
    return right(vault);
  }

  async findByToken(token: string) {
    const vault = await this.vaultRepository.findByToken(token);
    return vault;
  }
}
