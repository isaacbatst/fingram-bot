import { AiService } from '@/shared/ai/ai.service';
import { CsvParser } from '@/shared/csv-parser';
import { Action, ActionStatus, ActionType } from '@/vault/domain/action';
import { Either, left, right } from '@/vault/domain/either';
import { Transaction } from '@/vault/domain/transaction';
import { ActionRepository } from '@/vault/repositories/action.repository';
import { CategoryRepository } from '@/vault/repositories/category.repository';
import { TransactionRepository } from '@/vault/repositories/transaction.repository';
import { VaultRepository } from '@/vault/repositories/vault.repository';
import { BoxRepository } from '@/vault/repositories/box.repository';
import { Injectable, Logger } from '@nestjs/common';
import { ReadableStream } from 'node:stream/web';
import { Box } from './domain/box';
import { Category } from './domain/category';
import { Vault } from './domain/vault';
import { TransactionDTO } from './dto/transaction.dto,';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionCreatedEvent } from './events/transaction-created.event';
import { PlanQueryService } from '@/plan/shared/plan-query.service';

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  constructor(
    private vaultRepository: VaultRepository,
    private transactionRepository: TransactionRepository,
    private actionRepository: ActionRepository,
    private categoryRepository: CategoryRepository,
    private boxRepository: BoxRepository,
    private aiService: AiService,
    private eventEmitter: EventEmitter2,
    private planQueryService: PlanQueryService,
  ) {}

  async createVault() {
    this.logger.log('Creating new vault');
    const vault = Vault.create();
    console.log('created id', vault.id);
    await this.vaultRepository.create(vault);
    // Seed vault-specific categories from base categories
    await this.categoryRepository.seedForVault(vault.id);
    // Seed default box
    const defaultBox = Box.create({
      vaultId: vault.id,
      name: 'Principal',
      isDefault: true,
    });
    await this.boxRepository.create(defaultBox);
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
      return left(`Dados não encontrados`);
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

  async parseVaultAction(input: {
    message: string;
    vaultId: string;
    forceType?: 'income' | 'expense';
  }) {
    this.logger.log(`Parsing vault action: ${input.message}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Dados não encontrados`);
    }

    const customPrompt = vault.getCustomPrompt();
    const categories = await this.categoryRepository.findAllByVaultId(
      input.vaultId,
    );
    const [err, action] = await this.aiService.parseVaultAction(
      input.message,
      categories,
      customPrompt,
      input.forceType,
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
      return left(`Dados não encontrados`);
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
        date: new Date(),
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
        date: new Date(),
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
      return left(`Dados não encontrados`);
    }
    return right(vault);
  }

  async getTransactions(input: {
    vaultId: string;
    date?: {
      month: number;
      year: number;
    };
    categoryId?: string;
    description?: string;
    boxId?: string;
    page?: number;
    pageSize?: number;
  }) {
    this.logger.log(
      `Getting transactions for vault: ${input.vaultId} with page size: ${input.pageSize ?? 10}`,
    );
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Dados não encontrados`);
    }

    const date = input.date ?? vault.getCurrentBudgetPeriod();
    const { startDate, endDate } = vault.getBudgetPeriod(date.month, date.year);

    const transactions =
      await this.transactionRepository.findTransactionsByVaultId(
        input.vaultId,
        {
          dateRange: { startDate, endDate },
          categoryId: input.categoryId,
          description: input.description,
          boxId: input.boxId,
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
      boxId?: string;
      date: Date;
      shouldCommit?: boolean;
      type: 'expense' | 'income';
      allocationId?: string;
    };
    platform?: 'web' | 'telegram-bot';
  }): Promise<Either<string, { transaction: TransactionDTO; vault: Vault }>> {
    this.logger.log(`Adding transaction to vault: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Dados não encontrados`);
    }

    // Validate allocationId if provided
    if (input.transaction.allocationId) {
      const allocation = await this.planQueryService.findAllocationById(
        input.transaction.allocationId,
      );
      if (!allocation) return left('Alocação não encontrada');
      if (allocation.realizationMode !== 'immediate')
        return left(
          'Só alocações Pagamento podem ser vinculadas a transações',
        );
      const plan = await this.planQueryService.findPlanById(allocation.planId);
      if (!plan || plan.vaultId !== input.vaultId)
        return left('Alocação não pertence a este vault');
    }

    console.log('categoryId', input.transaction.categoryId);
    const category = input.transaction.categoryId
      ? await this.categoryRepository.findById(input.transaction.categoryId)
      : null;
    console.log('category', category);
    const transaction = Transaction.create({
      amount: input.transaction.amount,
      date: input.transaction.date,
      description: input.transaction.description,
      categoryId: input.transaction.categoryId,
      boxId: input.transaction.boxId,
      type: input.transaction.type,
      vaultId: vault.id,
      allocationId: input.transaction.allocationId,
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
    this.logger.log(
      `Vault after update: balance=${vault.getBalance()}, ` +
        `new_tx_committed=${vault.transactions.get(transaction.id)?.isCommitted}`,
    );
    this.logger.log(`Transaction added to vault: ${transaction.id}`);
    this.eventEmitter.emit(
      TransactionCreatedEvent.eventName,
      new TransactionCreatedEvent({
        vaultId: input.vaultId,
        transaction: transaction.toDTO(category),
        platform: input.platform ?? 'telegram-bot',
        balance: vault.getBalance(),
      }),
    );
    return right({
      transaction: transaction.toDTO(category),
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
    type?: 'income' | 'expense';
    boxId?: string;
    allocationId?: string | null;
  }) {
    this.logger.log(`Editing transaction in vault: ${JSON.stringify(input)}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Dados não encontrados`);
    }

    let categoryId: string | undefined;
    let category: Category | null = null;
    if (input.categoryCode) {
      category = await this.categoryRepository.findByCode(
        input.categoryCode,
        input.vaultId,
      );
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
      type?: 'income' | 'expense';
      boxId?: string;
    } = {};

    if (typeof input.newAmount === 'number')
      updatedData.amount = input.newAmount;
    if (typeof input.description === 'string')
      updatedData.description = input.description;
    if (categoryId) updatedData.categoryId = categoryId;
    if (input.date) updatedData.date = input.date;
    if (input.type) updatedData.type = input.type;
    if (typeof input.boxId === 'string') updatedData.boxId = input.boxId;

    // Validate and set allocationId if provided (null means remove, undefined means don't change)
    if (input.allocationId !== undefined) {
      if (input.allocationId === null) {
        (updatedData as any).allocationId = null;
      } else {
        const allocation = await this.planQueryService.findAllocationById(
          input.allocationId,
        );
        if (!allocation) return left('Alocação não encontrada');
        if (allocation.realizationMode !== 'immediate')
          return left(
            'Só alocações Pagamento podem ser vinculadas a transações',
          );
        const plan = await this.planQueryService.findPlanById(
          allocation.planId,
        );
        if (!plan || plan.vaultId !== input.vaultId)
          return left('Alocação não pertence a este vault');
        (updatedData as any).allocationId = input.allocationId;
      }
    }

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
      return left(`Dados não encontrados`);
    }
    vault.editCustomPrompt(input.customPrompt);
    await this.vaultRepository.update(vault);
    return right(vault.getCustomPrompt());
  }

  async getCategories(vaultId: string) {
    this.logger.log(`Getting categories for vault: ${vaultId}`);
    const categories = await this.categoryRepository.findAllByVaultId(vaultId);
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
      return left(`Dados não encontrados`);
    }
    const categories = await this.categoryRepository.findAllByVaultId(
      input.vaultId,
    );
    for (const budget of input.budgets) {
      // Support lookup by both ID and code for backwards compatibility
      // (web UI sends ID, telegram bot sends code)
      const category = categories.find(
        (cat) =>
          cat.id === budget.categoryCode || cat.code === budget.categoryCode,
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
      return left(`Dados não encontrados`);
    }
    const response = await fetch(input.fileUrl);
    if (!response.body) {
      this.logger.error(`Error fetching file: ${input.fileUrl}`);
      return left(`Erro ao buscar arquivo: ${input.fileUrl}`);
    }
    const categories = await this.categoryRepository.findAllByVaultId(
      input.vaultId,
    );
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
      return left(`Dados não encontrados`);
    }
    return right(vault.getCustomPrompt());
  }

  async appendVaultPrompt(input: { vaultId: string; appendText: string }) {
    this.logger.log(`Appending to vault prompt for vault: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Dados não encontrados`);
    }
    const current = vault.getCustomPrompt() || '';
    vault.editCustomPrompt(
      current ? current + '\n' + input.appendText : input.appendText,
    );
    await this.vaultRepository.update(vault);
    return right(vault.getCustomPrompt());
  }

  async setBudgetStartDay(input: {
    vaultId: string;
    day: number;
  }): Promise<Either<string, number>> {
    this.logger.log(
      `Setting budget start day for vault: ${input.vaultId} to day: ${input.day}`,
    );
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Dados não encontrados`);
    }
    const [err, day] = vault.setBudgetStartDay(input.day);
    if (err !== null) {
      this.logger.error(`Failed to set budget start day: ${err}`);
      return left(err);
    }
    await this.vaultRepository.update(vault);
    this.logger.log(`Budget start day set successfully to: ${day}`);
    return right(day);
  }

  async getBudgetStartDay(input: {
    vaultId: string;
  }): Promise<Either<string, number>> {
    this.logger.log(`Getting budget start day for vault: ${input.vaultId}`);
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Dados não encontrados`);
    }
    return right(vault.budgetStartDay);
  }

  async getBoxes(vaultId: string) {
    const vault = await this.vaultRepository.findById(vaultId);
    if (!vault) return left('Dados não encontrados');

    const boxes = Array.from(vault.boxes.values()).map((box) => ({
      id: box.id,
      name: box.name,
      goalAmount: box.goalAmount,
      isDefault: box.isDefault,
      type: box.type,
      balance: vault.getBoxBalance(box.id),
      goalProgress: box.goalAmount
        ? (vault.getBoxBalance(box.id) / box.goalAmount) * 100
        : null,
    }));

    return right(boxes);
  }

  async createBox(input: {
    vaultId: string;
    name: string;
    goalAmount?: number;
    type?: 'spending' | 'saving';
  }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');

    const box = Box.create({
      vaultId: vault.id,
      name: input.name,
      goalAmount: input.goalAmount ?? null,
      type: input.type,
    });
    vault.addBox(box);
    await this.vaultRepository.update(vault);

    return right({
      id: box.id,
      name: box.name,
      goalAmount: box.goalAmount,
      isDefault: box.isDefault,
      type: box.type,
      balance: 0,
      goalProgress: box.goalAmount ? 0 : null,
    });
  }

  async editBox(input: {
    vaultId: string;
    boxId: string;
    name?: string;
    goalAmount?: number | null;
    type?: 'spending' | 'saving';
  }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');

    const [err, box] = vault.editBox(input.boxId, {
      name: input.name,
      goalAmount: input.goalAmount,
      type: input.type,
    });
    if (err !== null) return left(err);

    await this.vaultRepository.update(vault);
    return right(box);
  }

  async deleteBox(input: { vaultId: string; boxId: string }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');

    const [err] = vault.deleteBox(input.boxId);
    if (err !== null) return left(err);

    await this.vaultRepository.update(vault);
    return right(true);
  }

  async createTransfer(input: {
    vaultId: string;
    fromBoxId: string;
    toBoxId: string;
    amount: number;
    date: Date;
  }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');

    const [err, transferId] = vault.createTransfer(input);
    if (err !== null) return left(err);

    await this.vaultRepository.update(vault);
    return right(transferId);
  }

  async editTransfer(input: {
    vaultId: string;
    transferId: string;
    amount?: number;
    date?: Date;
    fromBoxId?: string;
    toBoxId?: string;
  }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');

    const [err] = vault.editTransfer(input.transferId, {
      amount: input.amount,
      date: input.date,
      fromBoxId: input.fromBoxId,
      toBoxId: input.toBoxId,
    });
    if (err !== null) return left(err);

    await this.vaultRepository.update(vault);
    return right(true);
  }

  async deleteTransfer(input: { vaultId: string; transferId: string }) {
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) return left('Dados não encontrados');

    const [err] = vault.deleteTransfer(input.transferId);
    if (err !== null) return left(err);

    await this.vaultRepository.update(vault);
    return right(true);
  }

  async suggestCategory(input: {
    vaultId: string;
    description: string;
    transactionType: 'income' | 'expense';
  }): Promise<Either<string, string>> {
    this.logger.log(
      `Suggesting category for vault: ${input.vaultId}, description: ${input.description}`,
    );
    const vault = await this.vaultRepository.findById(input.vaultId);
    if (!vault) {
      this.logger.warn(`Vault not found: ${input.vaultId}`);
      return left(`Dados não encontrados`);
    }
    const categories = await this.categoryRepository.findAllByVaultId(
      input.vaultId,
    );
    const [err, categoryId] = await this.aiService.suggestCategory(
      input.description,
      input.transactionType,
      categories,
      vault.getCustomPrompt(),
    );
    if (err !== null) {
      this.logger.error(`Error suggesting category: ${err}`);
      return left(err);
    }
    this.logger.log(`Category suggested: ${categoryId}`);
    return right(categoryId);
  }
}
