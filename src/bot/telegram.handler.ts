import { Injectable, Logger } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { Either, left, right } from '../vault/domain/either';
import { BotService } from './bot.service';
import { TelegramMessageGenerator } from './telegram-message-generator';
import { ConfigService } from '@nestjs/config';
import { VaultWebService } from '../vault/vault-web.service';
import { OnEvent } from '@nestjs/event-emitter';
import { TransactionCreatedEvent } from '../vault/events/transaction-created.event';

@Injectable()
export class TelegramHandler {
  private readonly messageGenerator = new TelegramMessageGenerator();
  private readonly logger = new Logger(TelegramHandler.name);
  private readonly WEB_APP_URL: string;
  private readonly BOT_USERNAME: string;
  private readonly FRONTEND_URL: string;

  constructor(
    private telegraf: Telegraf,
    private botService: BotService,
    private vaultAuthService: VaultWebService,
    private configService: ConfigService,
  ) {
    this.WEB_APP_URL = this.configService.getOrThrow<string>(
      'TELEGRAM_MINIAPP_URL',
    );
    this.BOT_USERNAME = this.configService.getOrThrow<string>(
      'TELEGRAM_BOT_USERNAME',
    );
    this.FRONTEND_URL =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
  }

  @OnEvent(TransactionCreatedEvent.eventName)
  handleTransactionCreatedEvent(event: TransactionCreatedEvent) {
    return this.botService.handleCreatedTransaction(event, async (input) => {
      await this.telegraf.telegram.sendMessage(input.chatId, input.message, {
        parse_mode: 'MarkdownV2',
      });
    });
  }

  /**
   * Extrai o comando e os argumentos, removendo o sufixo @BOT_USERNAME se presente.
   * Retorna: { command: string, args: string[] }
   */
  private parseCommandAndArgs(text: string): {
    command: string;
    args: string[];
  } {
    const [cmd, ...rest] = text.trim().split(' ');
    const command = cmd.replace(new RegExp(`@${this.BOT_USERNAME}$`, 'i'), '');
    return { command, args: rest };
  }

  register() {
    this.logger.debug('Configuring Telegram bot commands and handlers...');

    this.telegraf.command('ai', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Uso: /ai <ação>\n\nExemplo: /ai 100 salário de setembro\n\n',
        );
        return;
      }
      await ctx.sendChatAction('typing');
      const message = args.join(' ');
      // Refatorado: usar botService para parseVaultAction
      const [err, action] = await this.botService.parseVaultAction({
        chatId,
        message,
      });
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(this.messageGenerator.formatActionDetected(action), {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '✅ Confirmar',
                callback_data: `ACTION:${action.id}`,
              },
              {
                text: '❌ Cancelar',
                callback_data: 'CANCEL',
              },
            ],
          ],
        },
      });
    });

    this.telegraf.command('receita', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Uso: /receita <valor> <descrição>\n\nExemplo: /receita 100 salário de setembro\n\n',
        );
        return;
      }
      await ctx.sendChatAction('typing');
      const message = `receita ${args.join(' ')}`;
      // Usar botService para parseVaultAction especificando receita
      const [err, action] = await this.botService.parseVaultAction({
        chatId,
        message,
        forceType: 'income',
      });
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(this.messageGenerator.formatActionDetected(action), {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '✅ Confirmar',
                callback_data: `ACTION:${action.id}`,
              },
              {
                text: '❌ Cancelar',
                callback_data: 'CANCEL',
              },
            ],
          ],
        },
      });
    });

    this.telegraf.command('despesa', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Uso: /despesa <valor> <descrição>\n\nExemplo: /despesa 50 supermercado\n\n',
        );
        return;
      }
      await ctx.sendChatAction('typing');
      const message = `despesa ${args.join(' ')}`;
      // Usar botService para parseVaultAction especificando despesa
      const [err, action] = await this.botService.parseVaultAction({
        chatId,
        message,
        forceType: 'expense',
      });
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(this.messageGenerator.formatActionDetected(action), {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '✅ Confirmar',
                callback_data: `ACTION:${action.id}`,
              },
              {
                text: '❌ Cancelar',
                callback_data: 'CANCEL',
              },
            ],
          ],
        },
      });
    });

    this.telegraf.on('callback_query', async (ctx) => {
      let data: string | undefined = undefined;
      if (
        ctx.callbackQuery &&
        typeof ctx.callbackQuery === 'object' &&
        'data' in ctx.callbackQuery
      ) {
        const raw = (ctx.callbackQuery as { data: unknown }).data;
        data = typeof raw === 'string' ? raw : '';
      }
      if (!data) return;
      if (data === 'CANCEL') {
        await ctx.editMessageText('Operação cancelada\\.', {
          parse_mode: 'MarkdownV2',
        });
        return;
      }
      if (typeof data === 'string' && data.startsWith('ACTION:') && ctx.chat) {
        try {
          const payloadStr = data.replace('ACTION:', '');
          // Refatorado: usar botService para handleVaultAction
          const [err, success] = await this.botService.handleVaultAction({
            actionId: payloadStr,
            chatId: ctx.chat.id.toString(),
          });
          if (err !== null) {
            await ctx.editMessageText(err);
            return;
          }
          const currentDate = new Date();
          await ctx.editMessageText(
            this.messageGenerator.formatTransactionSuccessMessage(
              success.vault.toJSON({
                date: {
                  month: currentDate.getMonth() + 1,
                  year: currentDate.getFullYear(),
                },
              }),
              success.transaction,
            ),
            { parse_mode: 'MarkdownV2' },
          );
        } catch (err) {
          console.error('Erro ao processar ação:', err);
          await ctx.editMessageText('Erro ao processar a ação.');
        }
        return;
      }
      return;
    });

    this.telegraf.on(message('text'), async (ctx, next) => {
      console.log('Received text message:', ctx.chat);
      return next();
    });

    this.telegraf.command('create', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      // Aceita /create ou /create@BOT_USERNAME, sem argumentos
      if (args.length > 0) {
        await ctx.reply(
          'Uso: /create\n\nCria um novo cofre para o chat atual.',
        );
        return;
      }
      const { vault } = await this.botService.handleCreate(chatId);
      await ctx.reply(this.messageGenerator.formatVaultCreated(vault), {
        parse_mode: 'MarkdownV2',
      });
    });

    this.telegraf.command('join', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Uso: /join <token\\>\n\nEntre em um cofre existente usando o token de acesso\\. Exemplo: /join ABC123',
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      const token = args[0];
      const [err, result] = await this.botService.handleJoin(chatId, token);
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(this.messageGenerator.formatVaultJoined(result.vault), {
        parse_mode: 'MarkdownV2',
      });
    });

    this.telegraf.command('income', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Uso: /income <quantia> [descrição]\n\nRegistra uma receita no cofre atual. Exemplo: /income 100 Salário',
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }

      // Parse income args
      const [parseError, parsedParams] = this.parseIncomeArgs(args);
      if (parseError !== null) {
        await ctx.reply(parseError);
        return;
      }

      const [err, success] = await this.botService.handleIncome(
        chatId,
        parsedParams,
      );
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      const currentDate = new Date();
      await ctx.reply(
        this.messageGenerator.formatTransactionSuccessMessage(
          success.vault.toJSON({
            date: {
              month: currentDate.getMonth() + 1,
              year: currentDate.getFullYear(),
            },
          }),
          success.transaction,
        ),
        { parse_mode: 'MarkdownV2' },
      );
    });

    this.telegraf.command('expense', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Uso: /expense <quantia> [descrição]\n\nRegistra uma despesa no cofre atual. Exemplo: /expense 50 Supermercado',
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      const [err, success] = await this.botService.handleExpense(chatId, args);
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      const currentDate = new Date();
      await ctx.reply(
        this.messageGenerator.formatTransactionSuccessMessage(
          success.vault.toJSON({
            date: {
              month: currentDate.getMonth() + 1,
              year: currentDate.getFullYear(),
            },
          }),
          success.transaction,
        ),
        { parse_mode: 'MarkdownV2' },
      );
    });

    this.telegraf.command('edit', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Para editar uma transação, você precisa fornecer o código da transação seguido dos campos que deseja alterar.\n\n' +
            '📝 Uso: /edit <código> [opções]\n\n' +
            'Opções disponíveis:\n' +
            '• -v <valor> - alterar o valor\n' +
            '• -d <dd/mm/yyyy> - alterar a data\n' +
            '• -c <categoria> - alterar a categoria\n' +
            '• -t <tipo> - alterar o tipo (income/expense)\n' +
            '• -desc "descrição" - alterar a descrição\n\n' +
            'Exemplos:\n' +
            '• /edit ABC123 -v 50.00\n' +
            '• /edit ABC123 -d 15/12/2024 -c alimentacao\n' +
            '• /edit ABC123 -desc "Almoço no restaurante"',
        );
        return;
      }

      // Parse edit transaction args
      const [parseError, parsedParams] = this.parseEditTransactionArgs(args);
      if (parseError !== null) {
        await ctx.reply(parseError);
        return;
      }

      const [err, success] = await this.botService.handleEdit(
        chatId,
        parsedParams,
      );
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        this.messageGenerator.formatTransactionEdited(
          parsedParams.transactionCode,
          success.transaction,
          success.vault,
        ),
        { parse_mode: 'MarkdownV2' },
      );
    });

    this.telegraf.command('setbudget', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      const argsText = args.join(' ');
      if (!argsText.trim()) {
        await ctx.reply(
          'Uso: /setbudget <categoria1> <quantia1>, <categoria2> <quantia2> ...\n\nDefine orçamentos para categorias específicas. Exemplo: /setbudget alimentacao 500, transporte 200',
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      const [err, vault] = await this.botService.handleSetBudget(
        chatId,
        argsText,
      );
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(this.messageGenerator.formatBudgetsSet(vault), {
        parse_mode: 'MarkdownV2',
      });
    });

    this.telegraf.command('summary', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      const argsText = args.join(' ');
      const [err, result] = await this.botService.handleSummary(
        chatId,
        argsText,
      );

      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        this.messageGenerator.formatVault(
          result.vault,
          result.budget,
          result.date,
        ),
        {
          parse_mode: 'MarkdownV2',
        },
      );
    });

    this.telegraf.command('categories', async (ctx) => {
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      // Aceita /categories ou /categories@BOT_USERNAME, sem argumentos
      if (args.length > 0) {
        await ctx.reply(
          'Uso: /categories\n\nLista todas as categorias disponíveis para uso em transações e orçamentos.',
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      const categories = await this.botService.handleCategories();
      if (categories.length === 0) {
        await ctx.reply('Nenhuma categoria disponível no momento.');
        return;
      }
      await ctx.reply(this.messageGenerator.formatCategories(categories), {
        parse_mode: 'MarkdownV2',
      });
    });

    this.telegraf.command('transactions', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      // Usa o texto original para garantir compatibilidade com /transactions@BOT_USERNAME
      const [parseArgsError, parsedArgs] = this.parseTransactionArgs(
        this.parseCommandAndArgs(ctx.message.text).command +
          ' ' +
          this.parseCommandAndArgs(ctx.message.text).args.join(' '),
      );
      if (parseArgsError !== null) {
        await ctx.reply(
          'Uso: /transactions [-p página] [-d mm/yyyy|dd/mm/yyyy]\n\nExibe as transações do cofre. Exemplo: /transactions -p 2 -d 06/2024',
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      const [err, transactions] = await this.botService.getTransactions(
        chatId,
        parsedArgs,
      );
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        this.messageGenerator.formatTransactions(transactions, {
          date: parsedArgs.date,
          page: parsedArgs.page,
        }),
        {
          parse_mode: 'MarkdownV2',
        },
      );
    });

    this.telegraf.on(message('document'), async (ctx) => {
      const document = ctx.message.document;
      this.logger.log(`Received document: ${document.file_id}`);
      if (document.mime_type !== 'text/csv') {
        this.logger.log(`Document ${document.file_id} is not a CSV file`);
        return;
      }
      this.logger.log(`Document ${document.file_id} is a CSV file`);
      try {
        await ctx.sendChatAction('typing');
        const href = await this.getFileHrefWithRetry(document.file_id);
        await ctx.reply('Processando arquivo. Isso pode levar alguns minutos.');
        const [err, vault] = await this.botService.handleProcessFile(
          ctx.chat.id.toString(),
          href,
        );
        if (err !== null) {
          return ctx.reply(err);
        }
        const currentDate = new Date();
        return ctx.reply(
          this.messageGenerator.formatVault(
            vault.toJSON({
              date: {
                month: currentDate.getMonth() + 1,
                year: currentDate.getFullYear(),
              },
            }),
            vault.getBudgetsSummary(
              currentDate.getMonth() + 1,
              currentDate.getFullYear(),
            ),
          ),
          {
            parse_mode: 'MarkdownV2',
          },
        );
      } catch (error) {
        console.error('Erro ao processar arquivo:', error);
        await ctx.reply(
          'Erro ao processar o arquivo. Certifique-se de que é um CSV válido com transações.',
        );
      }
    });

    // edit prompt command
    this.telegraf.command('editprompt', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Uso: /editprompt <novo prompt>\n\nEdita o prompt do cofre para personalizar a IA. Exemplo: /editprompt "Transferências para João são despesas de transporte"',
        );
        return;
      }
      const newPrompt = args.join(' ');
      const [err] = await this.botService.editVaultPrompt(chatId, newPrompt);
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        `Prompt editado com sucesso! Novo prompt:\n\n${newPrompt}`,
      );
    });

    // Comando para ler o prompt atual do cofre
    this.telegraf.command('getprompt', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const [err, prompt] = await this.botService.getVaultPrompt(chatId);
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        `Prompt atual do cofre:\n\n${prompt || 'Nenhum prompt definido.'}`,
      );
    });

    // Comando para adicionar texto ao prompt existente do cofre
    this.telegraf.command('appendprompt', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Uso: /appendprompt \\<texto para adicionar\\>\n\nAdiciona texto ao prompt atual do cofre\\.',
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      const appendText = args.join(' ');
      const [err, updated] = await this.botService.appendVaultPrompt(
        chatId,
        appendText,
      );
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        `Texto adicionado ao prompt com sucesso! Novo prompt:\n\n${updated}`,
      );
    });

    // delete transaction command /delete <transaction_code>
    this.telegraf.command('delete', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Uso: /delete <código da transação>\n\nDeleta uma transação pelo código. Exemplo: /delete 123456',
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      const [err, success] = await this.botService.deleteTransaction(
        chatId,
        args[0],
      );
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(success);
    });

    this.telegraf.on('message', async (ctx, next) => {
      if (ctx.message && 'web_app_data' in ctx.message) {
        this.logger.log('Received Web App data');
        const webAppData = ctx.message.web_app_data;
        if (!webAppData || !webAppData.data) {
          await ctx.reply('Nenhum dado recebido do Mini App.');
          return;
        }
        this.logger.log(`Received Web App data: ${webAppData.data}`);
        await ctx.reply(`Dados recebidos do Mini App: ${webAppData.data}`);
        return;
      }
      return next();
    });

    this.telegraf.command('miniapp', async (ctx) => {
      const [err, token] = await this.vaultAuthService.createLinkToken(
        ctx.chat.id.toString(),
      );
      if (err !== null) {
        this.logger.error('Error creating mini app token', err);
        await ctx.reply(
          'Erro ao criar link para o Mini App. Tente novamente mais tarde.',
        );
        return;
      }
      this.logger.log(`Generated token: ${token} for chatId: ${ctx.chat.id}`);
      const frontendLink = `${this.FRONTEND_URL}?token=${token}`;
      await ctx.reply(`[Abrir Aplicativo](${frontendLink})`, {
        parse_mode: 'Markdown',
      });
    });
    this.telegraf.on('inline_query', async (ctx) => {
      this.logger.log('Received inline query', ctx.inlineQuery.query);
      const webAppUrl = this.WEB_APP_URL;
      const button = {
        text: 'Abrir Mini App',
        web_app: { url: webAppUrl },
      };
      this.logger.log(`Answering inline query with button: ${button.text}`);
      await ctx.answerInlineQuery([], {
        button,
      });
    });

    this.telegraf.command('help', async (ctx) => {
      await ctx.reply(this.messageGenerator.formatHelp(), {
        parse_mode: 'Markdown',
      });
    });

    this.telegraf.catch(async (err, ctx) => {
      this.logger.error('Error in Telegram handler', err);
      if (ctx && ctx.chat) {
        await ctx.reply(
          'Erro interno ao processar sua solicitação. Por favor, tente novamente mais tarde.',
        );
      }
    });
  }

  private parseTransactionArgs(text: string): Either<
    string,
    {
      date?: {
        day?: number;
        month: number;
        year: number;
      };
      page: number;
    }
  > {
    const args = text.split(' ').slice(1);
    let page = 1;
    let date: { day?: number; month: number; year: number } | undefined;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-p' && args[i + 1]) {
        const parsedPage = parseInt(args[i + 1], 10);
        if (isNaN(parsedPage) || parsedPage < 1) {
          return left('Número de página inválido. Use um número maior que 0.');
        }
        page = parsedPage;
        i++;
        continue;
      }

      if (args[i] === '-d' && args[i + 1]) {
        const dateParts = args[i + 1].split('/');
        if (dateParts.length === 2) {
          // mm/yyyy
          const month = parseInt(dateParts[0], 10);
          const year = parseInt(dateParts[1], 10);
          if (
            isNaN(month) ||
            isNaN(year) ||
            month < 1 ||
            month > 12 ||
            year < 1000
          ) {
            return left('Formato de data inválido. Use mm/yyyy ou dd/mm/yyyy.');
          }
          date = { month, year };
          i++;
          continue;
        }
        if (dateParts.length === 3) {
          // dd/mm/yyyy
          const day = parseInt(dateParts[0], 10);
          const month = parseInt(dateParts[1], 10);
          const year = parseInt(dateParts[2], 10);
          if (
            isNaN(day) ||
            isNaN(month) ||
            isNaN(year) ||
            day < 1 ||
            day > 31 ||
            month < 1 ||
            month > 12 ||
            year < 1000
          ) {
            return left('Formato de data inválido. Use mm/yyyy ou dd/mm/yyyy.');
          }
          date = { day, month, year };
          i++;
          continue;
        }
        return left('Formato de data inválido. Use mm/yyyy ou dd/mm/yyyy.');
      }
    }

    return right({ date, page });
  }

  async getFileHrefWithRetry(fileId: string, maxRetries = 3): Promise<string> {
    let retries = 0;
    while (retries < maxRetries) {
      this.logger.log(`Getting file ${fileId} (retry ${retries + 1})`);
      try {
        const file = await this.telegraf.telegram.getFileLink(fileId);
        return file.href;
      } catch (error) {
        retries++;
        this.logger.error(
          `Error getting file ${fileId} (retry ${retries})`,
          error,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new Error('Failed to get file after retries');
  }

  /**
   * Parse income command arguments
   * Format: <amount> [description]
   */
  private parseIncomeArgs(args: string[]): Either<
    string,
    {
      amount: number;
      description?: string;
    }
  > {
    if (args.length < 1) {
      return left('Uso: /income <quantia> [descrição]');
    }

    const amount = parseFloat(args[0]);
    if (isNaN(amount)) {
      return left('Quantia inválida. Use um número.');
    }

    const description = args.slice(1).join(' ') || undefined;

    return right({
      amount,
      description,
    });
  }

  /**
   * Parse transaction edit command arguments
   * Format: <code> -v <valor> -d <dd/mm/yyyy> -c <categoria> -desc "descrição" -t <'expense' | 'income'>
   */
  private parseEditTransactionArgs(args: string[]): Either<
    string,
    {
      transactionCode: string;
      newAmount?: number;
      newDate?: Date;
      newCategory?: string;
      newDescription?: string;
      type?: 'income' | 'expense';
    }
  > {
    if (args.length < 1) {
      return left(
        'Para editar uma transação, você precisa fornecer o código da transação seguido dos campos que deseja alterar.',
      );
    }

    const transactionCode = args[0];
    const flags = args.slice(1);
    let newAmount: number | undefined;
    let newDate: Date | undefined;
    let newCategory: string | undefined;
    let newDescription: string | undefined;
    let type: 'income' | 'expense' | undefined;

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
      } else if (flag === '-t' && flags[i + 1]) {
        const t = flags[i + 1].toLowerCase();
        if (t === 'income' || t === 'expense') {
          type = t;
        } else {
          return left("Tipo inválido para -t. Use 'income' ou 'expense'.");
        }
        i++;
      }
    }

    return right({
      transactionCode,
      newAmount,
      newDate,
      newCategory,
      newDescription,
      type,
    });
  }
}
