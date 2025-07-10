import { AiService } from '@/shared/ai/ai.service';
import { CsvParser } from '@/shared/csv-parser';
import { Action, ActionStatus, ActionType } from '@/vault/domain/action';
import { Either, left, right } from '@/vault/domain/either';
import { Transaction } from '@/vault/domain/transaction';
import { ActionRepository } from '@/vault/repositories/action.repository';
import { CategoryRepository } from '@/vault/repositories/category.repository';
import { TransactionRepository } from '@/vault/repositories/transaction.repository';
import { VaultRepository } from '@/vault/repositories/vault.repository';
import { Injectable, Logger } from '@nestjs/common';
import { ReadableStream } from 'node:stream/web';
import { Category } from './domain/category';
import { Vault } from './domain/vault';
import { TransactionDTO } from './dto/transaction.dto,';

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  constructor(
    private vaultRepository: VaultRepository,
    private transactionRepository: TransactionRepository,
    private actionRepository: ActionRepository,
    private categoryRepository: CategoryRepository,
    private aiService: AiService,
  ) {}

  async createVault() {
    this.logger.log('Creating new vault');
    const vault = Vault.create();
    console.log('created id', vault.id);
    await this.vaultRepository.create(vault);
    this.logger.log(`Vault created with id: ${vault.id}`);
    return vault;
  }

  async deleteTransaction(input: { vaultId: string; transactionCode: string }) {
    this.logger.log(
      `Deleting transaction from vault: ${input.vaultId}, transactionCode: ${input.transactionCode}`,
    );
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Cofre não encontrado`);
    }
    const [err] = vault.deleteTransaction(input.transactionCode);
    if (err !== null) {
      this.logger.error(`Failed to delete transaction: ${err}`);
      return left(err);
    }
    await this.vaultRepository.update(vault);
    this.logger.log(`Transaction deleted: ${input.transactionCode}`);
    return right(true);
  }

  async parseVaultAction(input: { message: string; vaultId: string }) {
    this.logger.log(`Parsing vault action for vaultId: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Cofre não encontrado`);
    }
    const categories = await this.categoryRepository.findAll();
    const [err, action] = await this.aiService.parseVaultAction(
      input.message,
      categories,
      vault.getCustomPrompt(),
    );
    if (err !== null) {
      this.logger.error(`Error parsing action: ${err}`);
      return left(err);
    }
    await this.actionRepository.upsert(action);
    this.logger.log(`Action parsed and upserted: ${action.id}`);
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
    this.logger.log(
      `Handling vault action: actionId=${input.actionId}, vaultId=${input.vaultId}`,
    );
    const action = await this.actionRepository.findById(input.actionId);
    if (!action) {
      this.logger.warn(`Action not found: ${input.actionId}`);
      return left(`Ação não encontrada`);
    }
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Cofre não encontrado`);
    }
    switch (action.type) {
      case ActionType.INCOME:
        this.logger.log('Handling income action');
        return this.handleIncomeAction({ action, vaultId: input.vaultId });
      case ActionType.EXPENSE:
        this.logger.log('Handling expense action');
        return this.handleExpenseAction({ action, vaultId: input.vaultId });
      default:
        this.logger.error(`Unknown action type: ${action.type as string}`);
        return left(`Ação desconhecida`);
    }
  }

  private async handleIncomeAction(params: {
    action: Action;
    vaultId: string;
  }) {
    this.logger.log(`Adding income transaction to vault: ${params.vaultId}`);
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
      this.logger.error(`Failed to add income transaction: ${result[0]}`);
      action.status = ActionStatus.FAILED;
    }
    if (result[1]) {
      this.logger.log('Income transaction executed successfully');
      action.status = ActionStatus.EXECUTED;
    }
    await this.actionRepository.upsert(action);
    return result;
  }

  private async handleExpenseAction(params: {
    action: Action;
    vaultId: string;
  }) {
    this.logger.log(`Adding expense transaction to vault: ${params.vaultId}`);
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
      this.logger.error(`Failed to add expense transaction: ${result[0]}`);
      action.status = ActionStatus.FAILED;
    }
    if (result[1]) {
      this.logger.log('Expense transaction executed successfully');
      action.status = ActionStatus.EXECUTED;
    }
    await this.actionRepository.upsert(action);
    return result;
  }

  async getVault(input: { vaultId: string }) {
    this.logger.log(`Getting vault: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
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
    this.logger.log(`Getting transactions for vault: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
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
    this.logger.log(
      `Found ${transactions.items.length} transactions for vault: ${input.vaultId}`,
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
    this.logger.log(`Adding transaction to vault: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
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
      vaultId: vault.id,
    });
    vault.addTransaction(transaction);
    if (input.transaction.shouldCommit) {
      const [err] = vault.commitTransaction(transaction.id);
      if (err !== null) {
        this.logger.error(`Failed to commit transaction: ${err}`);
        return left(err);
      }
    }
    await this.vaultRepository.update(vault);
    this.logger.log(`Transaction added to vault: ${transaction.id}`);
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
    this.logger.log(`Editing transaction in vault: ${JSON.stringify(input)}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Cofre não encontrado`);
    }

    let categoryId: string | undefined;
    let category: Category | null = null;
    if (input.categoryCode) {
      category = await this.categoryRepository.findByCode(input.categoryCode);
      if (!category) {
        this.logger.warn(`Category not found: ${input.categoryCode}`);
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
    this.logger.log(
      `Editing transaction: ${input.transactionCode}, new data: ${JSON.stringify(
        transaction,
      )}`,
    );
    if (err !== null) {
      this.logger.error(`Failed to edit transaction: ${err}`);
      return left(err);
    }

    await this.vaultRepository.update(vault);

    if (transaction.categoryId && !category) {
      category = await this.categoryRepository.findById(transaction.categoryId);
    }

    this.logger.log(`Transaction edited: ${input.transactionCode}`);
    return right({
      transaction: transaction.toDTO(category),
      vault,
    });
  }

  async editVaultPrompt(input: { vaultId: string; customPrompt: string }) {
    this.logger.log(`Editing vault prompt for vault: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Cofre não encontrado`);
    }
    vault.editCustomPrompt(input.customPrompt);
    await this.vaultRepository.update(vault);
    return right(vault.getCustomPrompt());
  }

  async getCategories() {
    this.logger.log('Getting all categories');
    const categories = await this.categoryRepository.findAll();
    this.logger.log(`Found ${categories.length} categories`);
    return categories;
  }

  async setBudgets(input: {
    vaultId: string;
    budgets: { categoryCode: string; amount: number }[];
  }) {
    this.logger.log(`Setting budgets for vault: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Cofre não encontrado`);
    }
    const categories = await this.categoryRepository.findAll();
    for (const budget of input.budgets) {
      const category = categories.find(
        (cat) => cat.code === budget.categoryCode,
      );
      if (!category) {
        this.logger.warn(
          `Category not found for budget: ${budget.categoryCode}`,
        );
        continue;
      }
      const [err] = vault.setBudget(category, budget.amount);
      if (err !== null) {
        this.logger.error(
          `Failed to set budget for category ${category.code}: ${err}`,
        );
        return left(err);
      }
    }
    await this.vaultRepository.update(vault);
    this.logger.log('Budgets set successfully');
    return right(vault);
  }

  async processTransactionsFile(input: { vaultId: string; fileUrl: string }) {
    this.logger.log(
      `Processing transactions file for vault: ${input.vaultId}, fileUrl: ${input.fileUrl}`,
    );
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Cofre não encontrado`);
    }
    const response = await fetch(input.fileUrl);
    if (!response.body) {
      this.logger.error(`Error fetching file: ${input.fileUrl}`);
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
        vaultId: vault.id,
      });
    });
    const [err, parsedCategories] = await this.aiService.parseTransactionsFile(
      transactions,
      categories,
      vault.getCustomPrompt(),
    );
    if (err !== null) {
      this.logger.error(`Error processing transactions: ${err}`);
      return left(`Erro ao processar transações: ${err}`);
    }
    transactions.forEach((transaction) => {
      console.log(
        'Transaction ID:',
        transaction.id,
        parsedCategories.get(transaction.id),
      );
      transaction.categoryId = parsedCategories.get(transaction.id) || null;
    });
    for (const transaction of transactions) {
      vault.addTransaction(transaction);
      const [commitErr] = vault.commitTransaction(transaction.id);
      if (commitErr !== null) {
        this.logger.warn(
          `Failed to commit transaction: ${transaction.id}, error: ${commitErr}`,
        );
        continue;
      }
    }
    await this.vaultRepository.update(vault);
    this.logger.log('Transactions file processed and vault updated');
    return right(vault);
  }

  async findByToken(token: string) {
    this.logger.log(`Finding vault by token`);
    const vault = await this.vaultRepository.findByToken(token);
    if (vault) {
      this.logger.log(`Vault found for token`);
    } else {
      this.logger.warn(`No vault found for token`);
    }
    return vault;
  }

  async getVaultPrompt(input: { vaultId: string }) {
    this.logger.log(`Getting vault prompt for vault: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Cofre não encontrado`);
    }
    return right(vault.getCustomPrompt());
  }

  async appendVaultPrompt(input: { vaultId: string; appendText: string }) {
    this.logger.log(`Appending to vault prompt for vault: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Cofre não encontrado`);
    }
    const current = vault.getCustomPrompt() || '';
    vault.editCustomPrompt(
      current ? current + '\n' + input.appendText : input.appendText,
    );
    await this.vaultRepository.update(vault);
    return right(vault.getCustomPrompt());
  }
}
