import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Either, left, right } from '../vault/domain/either';
import { Paginated } from '../vault/domain/paginated';
import { TransactionDTO } from '../vault/dto/transaction.dto,';
import { VaultService } from '../vault/vault.service';
import { ChatService } from './modules/chat/chat.service';
import { JwtService } from '@nestjs/jwt';
import { MiniappSessionTokenPayload } from './miniapp-session-token';

export interface WebAppInitData {
  query_id?: string;
  chat?: {
    id: string;
    type: string;
    title?: string;
    username?: string;
    photo_url?: string;
  };
  chat_type?: string;
  chat_instance?: string;
  start_param?: string;
  can_send_after?: number;
  auth_date: number;
  hash: string;
}

// Tipos de erro do MiniApp
export enum MiniappErrorType {
  UNAUTHORIZED = 'UNAUTHORIZED',
  CHAT_NOT_FOUND = 'CHAT_NOT_FOUND',
  VAULT_NOT_FOUND = 'VAULT_NOT_FOUND',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface SummaryData {
  vault: any;
  budget: any;
  date: { year: number; month: number };
}

export interface MiniappError {
  message: string;
  type: MiniappErrorType;
}

@Injectable()
export class MiniappService {
  private readonly BOT_TOKEN: string;
  private readonly accessTokenStore: Map<
    string,
    {
      expiresAt: number;
      chatId: string;
      vaultId: string;
    }
  > = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly vaultService: VaultService,
    private readonly chatService: ChatService,
    private jwtService: JwtService,
  ) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!token) {
      console.warn(
        'TELEGRAM_BOT_TOKEN não definido! A validação do initData do MiniApp não funcionará corretamente.',
      );
      this.BOT_TOKEN = 'token-não-definido';
    } else {
      this.BOT_TOKEN = token;
    }
  }

  private errorLog(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    console.error(
      `[${timestamp}] [MiniAppService ERROR] ${message}`,
      data || '',
    );
  }

  async createLinkToken(chatId: string) {
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hora
    const [err, vaultId] = await this.getVaultIdFromChatId(chatId);
    if (err !== null) {
      return left({
        message: 'Erro ao obter o vaultId do chatId',
        type: MiniappErrorType.VAULT_NOT_FOUND,
      });
    }
    this.accessTokenStore.set(token, { expiresAt, chatId, vaultId });
    return right(token);
  }

  getAccessTokenData(token: string) {
    const entry = this.accessTokenStore.get(token);
    if (entry && entry.expiresAt > Date.now()) {
      return entry;
    }
    return null;
  }

  async exchangeInitDataForAuthToken(initData: string) {
    const validationResult = this.validateTelegramInitData({
      initData,
      botToken: this.BOT_TOKEN,
    });
    const { valid, data, reason } = validationResult;

    if (!valid) {
      return left({
        message: reason || 'Dados inválidos',
        type: MiniappErrorType.UNAUTHORIZED,
      });
    }

    if (!data || !data.start_param) {
      return left({
        message: 'Dados de inicialização inválidos',
        type: MiniappErrorType.UNAUTHORIZED,
      });
    }
    const accessTokenData = this.getAccessTokenData(data?.start_param);
    if (!accessTokenData) {
      return left({
        message: 'Erro ao obter o vaultId do start_param',
        type: MiniappErrorType.UNAUTHORIZED,
      });
    }
    const payload: MiniappSessionTokenPayload = {
      chatId: accessTokenData.chatId,
      vaultId: accessTokenData.vaultId,
    };
    const sessionToken = await this.jwtService.signAsync(payload, {
      expiresIn: '30d',
      secret: this.configService.get<string>('JWT_SECRET') || 'default_secret',
    });
    return right(sessionToken);
  }

  private validateTelegramInitData({
    initData,
    botToken,
    maxAuthDateDiffSeconds = 86400, // 24h (pode ajustar)
  }: {
    initData: string; // querystring recebida do Mini App
    botToken: string;
    maxAuthDateDiffSeconds?: number;
  }): {
    valid: boolean;
    data?: WebAppInitData;
    reason?: string;
  } {
    console.log('INIT DATA RECEIVED:', initData);
    // 1. Parseia o querystring usando URLSearchParams
    const urlParams = new URLSearchParams(initData);
    const data: Record<string, string> = {};
    for (const [key, value] of urlParams.entries()) {
      data[key] = value;
    }
    console.log(JSON.stringify(data, null, 2));

    // 2. Separa e remove o hash para o processo de validação
    const receivedHash = data.hash;
    if (!receivedHash) {
      return { valid: false, reason: 'hash not found in initData' };
    }
    delete data.hash;

    // 3. Monta o data_check_string conforme spec (ordem alfabética, key=<value>\n)
    const dataCheckArr = Object.keys(data)
      .sort()
      .map((key) => `${key}=${data[key]}`);
    const dataCheckString = dataCheckArr.join('\n');

    // 4. Gera secret_key = HMAC_SHA256(botToken, "WebAppData")
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // 5. Gera HMAC_SHA256(data_check_string, secretKey)
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // 6. Compara o hash recebido com o calculado
    if (calculatedHash !== receivedHash) {
      return { valid: false, reason: 'hash mismatch' };
    }

    // 7. Verifica se auth_date não está muito velho (proteção contra replay)
    const authDate = Number(data.auth_date);
    if (isNaN(authDate)) {
      return { valid: false, reason: 'invalid auth_date' };
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - authDate) > maxAuthDateDiffSeconds) {
      return { valid: false, reason: 'auth_date expired or too far in future' };
    }

    return { valid: true, data: data as unknown as WebAppInitData };
  }

  private async getVaultIdFromChatId(
    chatId: string,
  ): Promise<Either<MiniappError, string>> {
    const chat = await this.chatService.findChatByTelegramChatId(chatId);
    if (!chat) {
      return left({
        message: 'Chat não encontrado',
        type: MiniappErrorType.CHAT_NOT_FOUND,
      });
    }
    if (!chat.vaultId) {
      return left({
        message:
          'Cofre não inicializado. É necessário criar um novo cofre ou entrar em um cofre existente.',
        type: MiniappErrorType.VAULT_NOT_FOUND,
      });
    }
    return right(chat.vaultId);
  }

  // Simplified methods that work with vaultId directly (for authenticated routes)
  async getSummary(
    vaultId: string,
    customDate?: { year: number; month: number },
  ): Promise<Either<MiniappError, SummaryData>> {
    try {
      // Buscar o cofre diretamente usando o VaultService
      const [vaultError, vault] = await this.vaultService.getVault({ vaultId });
      if (vaultError !== null) {
        return left({
          message: vaultError,
          type: MiniappErrorType.VAULT_NOT_FOUND,
        });
      }

      // Usar data customizada ou o mês atual
      const now = new Date();
      const date = customDate || {
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      };
      const budget = vault.getBudgetsSummary(date.month, date.year);

      return right({
        vault: vault.toJSON({ date }),
        budget,
        date,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Erro ao processar a solicitação';

      this.errorLog('Erro não capturado no getSummary', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return left({
        message: errorMessage,
        type: MiniappErrorType.INTERNAL_ERROR,
      });
    }
  }

  async getTransactions(
    vaultId: string,
    options: {
      categoryId?: string;
      description?: string;
      date?: {
        year: number;
        month: number;
        day?: number;
      };
      page?: number;
    },
  ): Promise<Either<MiniappError, Paginated<TransactionDTO>>> {
    try {
      const transactionsResult = await this.vaultService.getTransactions({
        vaultId,
        date: options.date || {
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
        },
        page: options.page || 1,
        categoryId: options.categoryId,
        description: options.description,
        pageSize: 5,
      });

      const [transactionsError, transactionsData] = transactionsResult;
      if (transactionsError !== null) {
        return left({
          message: transactionsError,
          type: MiniappErrorType.INTERNAL_ERROR,
        });
      }

      return right(transactionsData);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Erro ao processar a solicitação';

      this.errorLog('Erro não capturado no getTransactions', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return left({
        message: errorMessage,
        type: MiniappErrorType.INTERNAL_ERROR,
      });
    }
  }

  async editTransaction(
    vaultId: string,
    editData: {
      transactionCode: string;
      newAmount?: number;
      newDate?: Date;
      newCategory?: string;
      newDescription?: string;
      newType?: 'income' | 'expense';
    },
  ): Promise<Either<MiniappError, { transaction: any; vault: any }>> {
    try {
      const editResult = await this.vaultService.editTransactionInVault({
        vaultId,
        transactionCode: editData.transactionCode,
        newAmount: editData.newAmount,
        date: editData.newDate,
        categoryCode: editData.newCategory,
        description: editData.newDescription,
        type: editData.newType,
      });

      const [editError, editSuccess] = editResult;
      if (editError !== null) {
        return left({
          message: editError,
          type: MiniappErrorType.INTERNAL_ERROR,
        });
      }

      return right(editSuccess);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Erro ao processar a solicitação';

      this.errorLog('Erro não capturado no editTransaction', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return left({
        message: errorMessage,
        type: MiniappErrorType.INTERNAL_ERROR,
      });
    }
  }

  async setBudgets(
    vaultId: string,
    budgets: { categoryCode: string; amount: number }[],
  ): Promise<Either<MiniappError, any>> {
    try {
      const [error, result] = await this.vaultService.setBudgets({
        vaultId,
        budgets,
      });

      if (error !== null) {
        this.errorLog('Error setting budgets', { vaultId, error });
        return left({
          message: error,
          type: MiniappErrorType.INTERNAL_ERROR,
        });
      }

      return right(result);
    } catch (error) {
      this.errorLog('Unexpected error setting budgets', error);
      return left({
        message: 'Erro interno do servidor',
        type: MiniappErrorType.INTERNAL_ERROR,
      });
    }
  }

  // Legacy methods that work with initData (for backward compatibility and exchange flow)
}
