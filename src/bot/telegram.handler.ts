import { Injectable, Logger } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { Either, left, right } from '../vault/domain/either';
import { BotService } from './bot.service';
import { TelegramMessageGenerator } from './telegram-message-generator';

@Injectable()
export class TelegramHandler {
  private readonly messageGenerator = new TelegramMessageGenerator();
  private readonly logger = new Logger(TelegramHandler.name);

  constructor(
    private telegraf: Telegraf,
    private botService: BotService,
  ) {}

  async onApplicationBootstrap() {
    this.telegraf.on(message('text'), async (ctx, next) => {
      if (!ctx.message.text.startsWith('@ai')) {
        return next();
      }
      await ctx.sendChatAction('typing');
      const message = ctx.message.text.split('@ai')[1].trim();

      if (!message) {
        await ctx.reply(
          'Uso: @ai <ação>\n\n' + 'Exemplo: @ai 100 salário de setembro\n\n',
        );
        return;
      }

      // Refatorado: usar botService para parseVaultAction
      const [err, action] = await this.botService.parseVaultAction({
        chatId: ctx.chat.id.toString(),
        message,
      });
      if (err !== null) {
        return ctx.reply(err);
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
      return next();
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
          await ctx.editMessageText(
            this.messageGenerator.formatTransactionSuccessMessage(
              success.vault,
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

    this.telegraf.command('create', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { vault } = await this.botService.handleCreate(chatId);
      await ctx.reply(this.messageGenerator.formatVaultCreated(vault), {
        parse_mode: 'MarkdownV2',
      });
    });

    this.telegraf.command('join', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const args = ctx.message.text.split(' ').slice(1);
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
      const args = ctx.message.text.split(' ').slice(1);
      const [err, success] = await this.botService.handleIncome(chatId, args);
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        this.messageGenerator.formatTransactionSuccessMessage(
          success.vault,
          success.transaction,
        ),
        { parse_mode: 'MarkdownV2' },
      );
    });

    this.telegraf.command('expense', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const args = ctx.message.text.split(' ').slice(1);
      const [err, success] = await this.botService.handleExpense(chatId, args);
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        this.messageGenerator.formatTransactionSuccessMessage(
          success.vault,
          success.transaction,
        ),
        { parse_mode: 'MarkdownV2' },
      );
    });

    this.telegraf.command('edit', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const args = ctx.message.text.split(' ').slice(1);
      const [err, success] = await this.botService.handleEdit(chatId, args);
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        this.messageGenerator.formatTransactionEdited(
          args[0],
          parseFloat(args[1]),
          success.vault,
        ),
        { parse_mode: 'MarkdownV2' },
      );
    });

    this.telegraf.command('setbudget', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const argsText = ctx.message.text.split('/setbudget').slice(1).join('');
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
      const [err, result] = await this.botService.handleSummary(
        chatId,
        ctx.message.text.split('/summary').slice(1).join(''),
      );

      console.log('result', result);
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        this.messageGenerator.formatVault(result.vault, result.budget),
        {
          parse_mode: 'MarkdownV2',
        },
      );
    });

    this.telegraf.command('categories', async (ctx) => {
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
      const [parseArgsError, parsedArgs] = this.parseTransactionArgs(
        ctx.message.text,
      );
      if (parseArgsError !== null) {
        await ctx.reply(parseArgsError);
        return;
      }
      const [err, transactions] = await this.botService.handleTransactions(
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
        return ctx.reply(
          this.messageGenerator.formatVault(vault, vault.getBudgetsSummary()),
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

    await this.telegraf.launch();
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
}
