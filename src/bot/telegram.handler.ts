import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    private configService: ConfigService,
  ) {}

  /**
   * Extrai o comando e os argumentos, removendo o sufixo @DinheirosTelegramBot se presente.
   * Retorna: { command: string, args: string[] }
   */
  private parseCommandAndArgs(text: string): {
    command: string;
    args: string[];
  } {
    const [cmd, ...rest] = text.trim().split(' ');
    const command = cmd.replace(/@DinheirosTelegramBot$/i, '');
    return { command, args: rest };
  }

  onApplicationBootstrap() {
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
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      // Aceita /create ou /create@DinheirosTelegramBot, sem argumentos
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
          'Uso: /join <token>\n\nEntre em um cofre existente usando o token de acesso. Exemplo: /join ABC123',
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
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Para editar uma transação, você precisa fornecer o código da transação seguido dos campos que deseja alterar.\n\n' +
            '📝 Uso: /edit <código> [opções]\n\n' +
            'Opções disponíveis:\n' +
            '• -v <valor> - alterar o valor\n' +
            '• -d <dd/mm/yyyy> - alterar a data\n' +
            '• -c <categoria> - alterar a categoria\n' +
            '• -desc "descrição" - alterar a descrição\n\n' +
            'Exemplos:\n' +
            '• /edit ABC123 -v 50.00\n' +
            '• /edit ABC123 -d 15/12/2024 -c alimentacao\n' +
            '• /edit ABC123 -desc "Almoço no restaurante"',
        );
        return;
      }
      const [err, success] = await this.botService.handleEdit(chatId, args);
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        this.messageGenerator.formatTransactionEdited(
          args[0],
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
      // Aceita /categories ou /categories@DinheirosTelegramBot, sem argumentos
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
      // Usa o texto original para garantir compatibilidade com /transactions@DinheirosTelegramBot
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

    // edit prompt command
    this.telegraf.command('editprompt', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const { args } = this.parseCommandAndArgs(ctx.message.text);
      if (args.length === 0) {
        await ctx.reply(
          'Uso: /editprompt <novo prompt>\n\nEdita o prompt do cofre para personalizar a IA. Exemplo: /editprompt "Transferências para João são despesas de transporte"',
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }
      const newPrompt = args.join(' ');
      const [err] = await this.botService.editVaultPrompt(chatId, newPrompt);
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply('Prompt editado com sucesso!');
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
}
