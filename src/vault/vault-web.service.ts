import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { ChatService } from '../bot/modules/chat/chat.service';
import { AccessTokenStore } from '../shared/cache/access-token-store';
import { Either, left, right } from './domain/either';
import { Paginated } from './domain/paginated';
import { BudgetSummary, SerializedVault, Vault } from './domain/vault';
import { TransactionDTO } from './dto/transaction.dto,';
import { VaultService } from './vault.service';

export enum VaultErrorType {
  UNAUTHORIZED = 'UNAUTHORIZED',
  VAULT_NOT_FOUND = 'VAULT_NOT_FOUND',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface VaultError {
  type: VaultErrorType;
  message: string;
}

@Injectable()
export class VaultWebService {
  private readonly logger = new Logger(VaultWebService.name);
  constructor(
    private readonly vaultService: VaultService,
    private readonly chatService: ChatService,
  ) {}

  async authenticate(accessToken: string): Promise<Either<VaultError, string>> {
    try {
      this.logger.log(`Authenticating vault with access token`);

      const vault = await this.vaultService.findByToken(accessToken);

      if (!vault) {
        this.logger.warn(`Vault not found for access token`);
        return left({
          type: VaultErrorType.VAULT_NOT_FOUND,
          message: 'Vault não encontrado para o token fornecido',
        });
      }

      this.logger.log(`Vault authenticated successfully: ${vault.id}`);
      return right(vault.token);
    } catch (error) {
      this.logger.error(`Error authenticating vault: ${error}`);
      return left({
        type: VaultErrorType.INTERNAL_ERROR,
        message: 'Erro interno ao autenticar vault',
      });
    }
  }

  async createLinkToken(chatId: string): Promise<Either<VaultError, string>> {
    try {
      const token = crypto.randomUUID();
      const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

      const [err, vaultId] = await this.getVaultIdFromChatId(chatId);
      if (err !== null) {
        return left({
          type: VaultErrorType.VAULT_NOT_FOUND,
          message: 'Erro ao obter o vaultId do chatId',
        });
      }

      AccessTokenStore.store.set(token, { expiresAt, chatId, vaultId });
      return right(token);
    } catch (error) {
      this.logger.error(`Error creating link token: ${error}`);
      return left({
        type: VaultErrorType.INTERNAL_ERROR,
        message: 'Erro interno ao criar token de link',
      });
    }
  }

  getAccessTokenData(token: string) {
    const entry = AccessTokenStore.store.get(token);
    if (entry && entry.expiresAt > Date.now()) {
      return entry;
    }
    return null;
  }

  deleteAccessToken(token: string) {
    AccessTokenStore.store.delete(token);
  }

  async authenticateTempToken(
    tempToken: string,
  ): Promise<Either<VaultError, string>> {
    try {
      this.logger.log(`Authenticating with temporary token`);

      // Get access token data from local store
      const accessTokenData = this.getAccessTokenData(tempToken);
      if (!accessTokenData) {
        this.logger.warn(`Temporary token not found or expired`);
        return left({
          type: VaultErrorType.UNAUTHORIZED,
          message: 'Token temporário inválido ou expirado',
        });
      }

      // Get the vault using the vaultId from the temporary token
      const [vaultError, vault] = await this.vaultService.getVault({
        vaultId: accessTokenData.vaultId,
      });

      if (vaultError !== null) {
        this.logger.warn(`Vault not found for temporary token: ${vaultError}`);
        return left({
          type: VaultErrorType.VAULT_NOT_FOUND,
          message: 'Vault não encontrado para o token temporário',
        });
      }

      // Remove the temporary token after successful authentication
      this.deleteAccessToken(tempToken);

      this.logger.log(
        `Vault authenticated successfully with temp token: ${vault.id}`,
      );
      return right(vault.token);
    } catch (error) {
      this.logger.error(`Error authenticating with temporary token: ${error}`);
      return left({
        type: VaultErrorType.INTERNAL_ERROR,
        message: 'Erro interno ao autenticar com token temporário',
      });
    }
  }

  private async getVaultIdFromChatId(
    chatId: string,
  ): Promise<Either<VaultError, string>> {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) {
      return left({
        type: VaultErrorType.VAULT_NOT_FOUND,
        message: 'Chat não encontrado',
      });
    }
    if (!chat.vaultId) {
      return left({
        type: VaultErrorType.VAULT_NOT_FOUND,
        message:
          'Cofre não inicializado. É necessário criar um novo cofre ou entrar em um cofre existente.',
      });
    }
    return right(chat.vaultId);
  }

  async getSummary(
    vaultId: string,
    date?: { year: number; month: number },
  ): Promise<
    Either<
      VaultError,
      {
        vault: SerializedVault;
        budget: BudgetSummary[];
        date: { year: number; month: number };
      }
    >
  > {
    try {
      this.logger.log(`Getting summary for vault: ${vaultId}`);

      // Get vault directly using VaultService
      const [vaultError, vault] = await this.vaultService.getVault({ vaultId });
      if (vaultError !== null) {
        return left({
          type: VaultErrorType.VAULT_NOT_FOUND,
          message: vaultError,
        });
      }

      // Use custom date or current month
      const now = new Date();
      const targetDate = date || {
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      };
      const budget = vault.getBudgetsSummary(targetDate.month, targetDate.year);

      return right({
        vault: vault.toJSON({ date: targetDate }),
        budget,
        date: targetDate,
      });
    } catch (error) {
      this.logger.error(`Error getting summary for vault ${vaultId}: ${error}`);
      return left({
        type: VaultErrorType.INTERNAL_ERROR,
        message: 'Erro interno ao obter resumo',
      });
    }
  }

  async getTransactions(
    vaultId: string,
    params: {
      categoryId?: string;
      description?: string;
      date?: { year: number; month: number };
      page: number;
    },
  ): Promise<Either<VaultError, Paginated<TransactionDTO>>> {
    try {
      this.logger.log(`Getting transactions for vault: ${vaultId}`);

      // Use VaultService directly
      const [error, transactions] = await this.vaultService.getTransactions({
        vaultId,
        date: params.date || {
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
        },
        page: params.page || 1,
        categoryId: params.categoryId,
        description: params.description,
      });

      if (error !== null) {
        return left({
          type: VaultErrorType.VAULT_NOT_FOUND,
          message: error,
        });
      }

      return right(transactions);
    } catch (error) {
      this.logger.error(
        `Error getting transactions for vault ${vaultId}: ${error}`,
      );
      return left({
        type: VaultErrorType.INTERNAL_ERROR,
        message: 'Erro interno ao obter transações',
      });
    }
  }

  async createTransaction(
    vaultId: string,
    data: {
      amount: number;
      description?: string;
      categoryId?: string;
      date?: Date;
      type: 'income' | 'expense';
    },
  ): Promise<
    Either<
      VaultError,
      {
        transaction: TransactionDTO;
        vault: Vault;
      }
    >
  > {
    try {
      this.logger.log(`Creating transaction for vault: ${vaultId}`);

      // Use VaultService directly
      const [error, result] = await this.vaultService.addTransactionToVault({
        vaultId,
        transaction: {
          amount: data.amount,
          description: data.description,
          categoryId: data.categoryId,
          type: data.type,
          shouldCommit: true, // Auto-commit new transactions
        },
        platform: 'web',
      });

      if (error !== null) {
        return left({
          type: VaultErrorType.VAULT_NOT_FOUND,
          message: error,
        });
      }

      return right(result);
    } catch (error) {
      this.logger.error(
        `Error creating transaction for vault ${vaultId}: ${error}`,
      );
      return left({
        type: VaultErrorType.INTERNAL_ERROR,
        message: 'Erro interno ao criar transação',
      });
    }
  }

  async editTransaction(
    vaultId: string,
    data: {
      transactionCode: string;
      newAmount?: number;
      newDate?: Date;
      newCategory?: string;
      newDescription?: string;
      newType?: 'income' | 'expense';
    },
  ): Promise<
    Either<
      VaultError,
      {
        transaction: TransactionDTO;
        vault: Vault;
      }
    >
  > {
    try {
      this.logger.log(`Editing transaction for vault: ${vaultId}`);

      // Use VaultService directly
      const [error, result] = await this.vaultService.editTransactionInVault({
        vaultId,
        transactionCode: data.transactionCode,
        newAmount: data.newAmount,
        date: data.newDate,
        categoryCode: data.newCategory,
        description: data.newDescription,
        type: data.newType,
      });

      if (error !== null) {
        return left({
          type: VaultErrorType.VAULT_NOT_FOUND,
          message: error,
        });
      }

      return right(result);
    } catch (error) {
      this.logger.error(
        `Error editing transaction for vault ${vaultId}: ${error}`,
      );
      return left({
        type: VaultErrorType.INTERNAL_ERROR,
        message: 'Erro interno ao editar transação',
      });
    }
  }

  async setBudgets(
    vaultId: string,
    budgets: { categoryCode: string; amount: number }[],
  ): Promise<Either<VaultError, Vault>> {
    try {
      this.logger.log(`Setting budgets for vault: ${vaultId}`);

      // Use VaultService directly
      const [error, result] = await this.vaultService.setBudgets({
        vaultId,
        budgets,
      });

      if (error !== null) {
        return left({
          type: VaultErrorType.VAULT_NOT_FOUND,
          message: error,
        });
      }

      return right(result);
    } catch (error) {
      this.logger.error(`Error setting budgets for vault ${vaultId}: ${error}`);
      return left({
        type: VaultErrorType.INTERNAL_ERROR,
        message: 'Erro interno ao definir orçamentos',
      });
    }
  }
}
