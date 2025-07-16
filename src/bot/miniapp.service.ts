import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { parse } from 'querystring';
import { Either, left, right } from '../vault/domain/either';
import { BotService } from './bot.service';
import { Paginated } from '../vault/domain/paginated';
import { TransactionDTO } from '../vault/dto/transaction.dto,';

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

  private readonly tokenStore: Map<
    string,
    {
      expiresAt: number;
      chatId: number;
    }
  > = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly botService: BotService,
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

  async getSummaryFromInitData(
    initDataString: string,
  ): Promise<Either<MiniappError, SummaryData>> {
    try {
      this.debugLog('Iniciando getSummaryFromInitData', {
        initDataLength: initDataString?.length || 0,
        hasInitData: !!initDataString,
      });

      // Primeiro validar os dados de inicialização
      const validationResult = this.validateTelegramInitData({
        initData: initDataString,
        botToken: this.BOT_TOKEN,
      });
      const { valid, data, reason } = validationResult;

      if (!valid) {
        this.debugLog('Erro na validação dos dados', {
          reason,
        });
        return left({
          message: reason || 'Dados inválidos',
          type: MiniappErrorType.UNAUTHORIZED,
        });
      }

      this.debugLog('Dados validados com sucesso', JSON.stringify(data));
      if (!data || !data.start_param) {
        return left({
          message: 'Dados de inicialização inválidos',
          type: MiniappErrorType.UNAUTHORIZED,
        });
      }
      const chatId = this.getChatIdFromToken(data?.start_param);
      if (!chatId) {
        this.debugLog('Chat ID não encontrado a partir do token', {
          startParam: data.start_param,
        });
        return left({
          message: 'Chat ID não encontrado',
          type: MiniappErrorType.CHAT_NOT_FOUND,
        });
      }
      // Buscar o resumo do cofre usando o BotService
      const summaryResult = await this.botService.handleSummary(
        chatId.toString(),
        '',
      );
      const [summaryError, summaryData] = summaryResult;

      if (summaryError !== null) {
        this.debugLog('Erro do BotService', {
          summaryError,
          chatId: chatId,
        });

        // Determinar o tipo de erro com base na mensagem
        let errorType = MiniappErrorType.INTERNAL_ERROR;

        if (summaryError.includes('Cofre não encontrado')) {
          errorType = MiniappErrorType.VAULT_NOT_FOUND;
        }

        return left({
          message: summaryError,
          type: errorType,
        });
      }

      // Retornar os dados do resumo em caso de sucesso
      return right(summaryData);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Erro ao processar a solicitação';

      this.errorLog('Erro não capturado no getSummaryFromInitData', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return left({
        message: errorMessage,
        type: MiniappErrorType.INTERNAL_ERROR,
      });
    }
  }

  async getTransactionsFromInitData(
    initDataString: string,
    options: {
      categoryId?: string;
      date?: {
        year: number;
        month: number;
        day?: number;
      };
      page?: number;
    },
  ): Promise<Either<MiniappError, Paginated<TransactionDTO>>> {
    try {
      this.debugLog('Iniciando getTransactionsFromInitData', {
        initDataLength: initDataString?.length || 0,
        hasInitData: !!initDataString,
      });
      // Primeiro validar os dados de inicialização
      const validationResult = this.validateTelegramInitData({
        initData: initDataString,
        botToken: this.BOT_TOKEN,
      });
      const { valid, data, reason } = validationResult;
      if (!valid) {
        this.debugLog('Erro na validação dos dados', {
          reason,
        });
        return left({
          message: reason || 'Dados inválidos',
          type: MiniappErrorType.UNAUTHORIZED,
        });
      }
      this.debugLog('Dados validados com sucesso', JSON.stringify(data));
      if (!data || !data.start_param) {
        return left({
          message: 'Dados de inicialização inválidos',
          type: MiniappErrorType.UNAUTHORIZED,
        });
      }
      const chatId = this.getChatIdFromToken(data?.start_param);
      if (!chatId) {
        this.debugLog('Chat ID não encontrado a partir do token', {
          startParam: data.start_param,
        });
        return left({
          message: 'Chat ID não encontrado',
          type: MiniappErrorType.CHAT_NOT_FOUND,
        });
      }
      // Buscar as transações usando o BotService
      const transactionsResult = await this.botService.getTransactions(
        chatId.toString(),
        {
          categoryId: options.categoryId,
          date: {
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1, // Mês é 0-indexado
          },
          page: options.page || 1, // Padrão para a primeira página
        },
      );
      const [transactionsError, transactionsData] = transactionsResult;
      if (transactionsError !== null) {
        this.debugLog('Erro do BotService ao buscar transações', {
          transactionsError,
          chatId: chatId,
        });

        // Determinar o tipo de erro com base na mensagem
        let errorType = MiniappErrorType.INTERNAL_ERROR;

        if (transactionsError.includes('Cofre não encontrado')) {
          errorType = MiniappErrorType.VAULT_NOT_FOUND;
        }

        return left({
          message: transactionsError,
          type: errorType,
        });
      }
      console.log(JSON.stringify(transactionsData, null, 2));
      // Retornar os dados das transações em caso de sucesso
      return right(transactionsData);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Erro ao processar a solicitação';
      this.errorLog('Erro não capturado no getTransactionsFromInitData', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return left({
        message: errorMessage,
        type: MiniappErrorType.INTERNAL_ERROR,
      });
    }
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
    // 1. Parseia o querystring
    const data = parse(initData);

    // 2. Separa e remove o hash para o processo de validação
    const receivedHash = data.hash as string;
    if (!receivedHash) {
      return { valid: false, reason: 'hash not found in initData' };
    }
    delete data.hash;

    // 3. Monta o data_check_string conforme spec (ordem alfabética, key=<value>\n)
    const dataCheckArr = Object.keys(data)
      .sort()
      .map((key) => `${key}=${data[key] as string}`);
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

  /**
   * Log de debug para desenvolvimento
   */
  private debugLog(message: string, data?: any): void {
    const isDevelopment =
      this.configService.get<string>('NODE_ENV') !== 'production';
    const isDebugEnabled =
      this.configService.get<string>('MINIAPP_DEBUG') === 'true';

    if (isDevelopment || isDebugEnabled) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [MiniAppService] ${message}`, data || '');
    }
  }

  /**
   * Log de erro que sempre aparece
   */
  private errorLog(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    console.error(
      `[${timestamp}] [MiniAppService ERROR] ${message}`,
      data || '',
    );
  }

  async editTransactionFromInitData(
    initDataString: string,
    editData: {
      transactionCode: string;
      newAmount?: number;
      newDate?: Date;
      newCategory?: string;
      newDescription?: string;
    },
  ): Promise<Either<MiniappError, { transaction: any; vault: any }>> {
    try {
      this.debugLog('Iniciando editTransactionFromInitData', {
        initDataLength: initDataString?.length || 0,
        hasInitData: !!initDataString,
        editData,
      });

      // Primeiro validar os dados de inicialização
      const validationResult = this.validateTelegramInitData({
        initData: initDataString,
        botToken: this.BOT_TOKEN,
      });
      const { valid, data, reason } = validationResult;

      if (!valid) {
        this.debugLog('Erro na validação dos dados', {
          reason,
        });
        return left({
          message: reason || 'Dados inválidos',
          type: MiniappErrorType.UNAUTHORIZED,
        });
      }

      this.debugLog('Dados validados com sucesso', JSON.stringify(data));
      if (!data || !data.start_param) {
        return left({
          message: 'Parâmetro de início não encontrado',
          type: MiniappErrorType.UNAUTHORIZED,
        });
      }

      const chatId = this.getChatIdFromToken(data?.start_param);
      if (!chatId) {
        return left({
          message: 'Sessão inválida ou expirada',
          type: MiniappErrorType.UNAUTHORIZED,
        });
      }

      // Editar a transação usando o BotService
      const editResult = await this.botService.handleEdit(
        chatId.toString(),
        editData,
      );
      const [editError, editSuccess] = editResult;

      if (editError !== null) {
        return left({
          message: editError,
          type: MiniappErrorType.INTERNAL_ERROR,
        });
      }

      // Retornar os dados da transação editada em caso de sucesso
      return right(editSuccess);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Erro ao processar a solicitação';

      this.errorLog('Erro não capturado no editTransactionFromInitData', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return left({
        message: errorMessage,
        type: MiniappErrorType.INTERNAL_ERROR,
      });
    }
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
