/* eslint-disable no-useless-escape */
import { Injectable } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { AiService } from './ai/ai.service';
import { AppService } from './app.service';
import { ActionType } from './domain/action';
import { Vault } from './domain/vault';
import { Transaction } from './domain/transaction';

@Injectable()
export class TelegramHandler {
  constructor(
    private telegraf: Telegraf,
    private appService: AppService,
    private aiService: AiService,
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

      const [err, action] = await this.appService.parseVaultAction({
        chatId: ctx.chat.id.toString(),
        message,
      });
      if (err !== null) {
        return ctx.reply(err);
      }

      const emoji = action.type === ActionType.INCOME ? '🟢' : '🔴';
      const formattedAmount = Math.abs(action.payload.amount).toLocaleString(
        'pt-BR',
        {
          style: 'currency',
          currency: 'BRL',
          minimumFractionDigits: 2,
        },
      );
      await ctx.reply(
        `${emoji} Detectei que você deseja registrar a seguinte ${action.type === ActionType.INCOME ? 'receita' : 'despesa'}:\n\n` +
          `*Valor:* ${this.escapeMarkdownV2(formattedAmount)}\n` +
          `*Descrição:* ${action.payload.description ? this.escapeMarkdownV2(action.payload.description) : 'Sem descrição'}\n\n` +
          `Deseja confirmar?`,
        {
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
        },
      );
      return next();
    });

    this.telegraf.command('create', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const vault = await this.appService.createVault({ chatId });
      await ctx.reply(
        `Cofre criado com sucesso\\!\n\n` +
          `*Token de Acesso:* \`${this.escapeMarkdownV2(vault.token)}\`\n\n` +
          `Use /help para ver os comandos disponíveis\\.`,
        { parse_mode: 'MarkdownV2' },
      );
    });
    this.telegraf.command('join', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) {
        await ctx.reply('Uso: /join <token>');
        return;
      }
      const token = args[0];
      const [err, vault] = await this.appService.joinVault({
        chatId,
        vaultToken: token,
      });
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        `Você se conectou ao cofre com sucesso\\!\n\n` +
          `*ID do Cofre:* ${this.escapeMarkdownV2(vault.id)}\n` +
          `*Token de Acesso:* ${this.escapeMarkdownV2(vault.token)}\n\n` +
          `Agora você pode registrar receitas e despesas neste cofre\\.`,
        { parse_mode: 'MarkdownV2' },
      );
    });

    this.telegraf.command('income', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) {
        await ctx.reply('Uso: /income <quantia> [descrição]');
        return;
      }
      const amount = parseFloat(args[0]);
      if (isNaN(amount)) {
        await ctx.reply('Quantia inválida. Use um número.');
        return;
      }
      const description = args.slice(1).join(' ') || undefined;
      const transaction = {
        amount,
        description,
        shouldCommit: true,
      };
      const [err, success] = await this.appService.addTransactionToVault({
        chatId,
        transaction,
      });
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        this.formatTransactionSuccessMessage(
          success.vault,
          success.transaction,
        ),
        { parse_mode: 'MarkdownV2' },
      );
    });

    this.telegraf.command('expense', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) {
        await ctx.reply('Uso: /expense <quantia> [descrição]');
        return;
      }
      const amount = parseFloat(args[0]);
      if (isNaN(amount)) {
        await ctx.reply('Quantia inválida. Use um número.');
        return;
      }
      const description = args.slice(1).join(' ') || undefined;
      const transaction = {
        amount: -amount,
        description,
        shouldCommit: true,
      };
      const [err, success] = await this.appService.addTransactionToVault({
        chatId,
        transaction,
      });
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        this.formatTransactionSuccessMessage(
          success.vault,
          success.transaction,
        ),
        { parse_mode: 'MarkdownV2' },
      );
    });

    this.telegraf.command('edit', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 2) {
        await ctx.reply('Uso: /edit <código> <nova quantia>');
        return;
      }
      const code = args[0];
      const newAmount = parseFloat(args[1]);
      if (isNaN(newAmount)) {
        await ctx.reply('Nova quantia inválida. Use um número.');
        return;
      }
      const [err, success] = await this.appService.editTransactionInVault({
        chatId,
        transactionCode: code,
        newAmount,
      });
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(
        `Transação\#${this.escapeMarkdownV2(code)} editada com sucesso\\!\n\n` +
          `*Novo valor:* R$ ${this.escapeMarkdownV2(newAmount.toFixed(2).replace('.', ','))}\n` +
          `*Saldo atual:* R$ ${this.escapeMarkdownV2(success.vault.getBalance().toFixed(2).replace('.', ','))}`,
        { parse_mode: 'MarkdownV2' },
      );
    });
    this.telegraf.command('summary', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const [err, vault] = await this.appService.getVault({ chatId });
      if (err !== null) {
        await ctx.reply(err);
        return;
      }
      await ctx.reply(this.formatVault(vault), {
        parse_mode: 'MarkdownV2',
      });
    });

    this.telegraf.command('help', async (ctx) => {
      const helpText =
        'Envie uma mensagem começando com `@ai`:\n\n' +
        '_Exemplos:_ \n\n`@ai 100 salário de setembro`\n`@ai 50 compra de supermercado`\n\n' +
        'Para ver todos os comandos disponíveis, digite /commands.\n\n';

      await ctx.reply(helpText, {
        parse_mode: 'Markdown',
      });
    });

    this.telegraf.command('commands', async (ctx) => {
      const commandsText =
        'Comandos disponíveis:\n\n' +
        '/expense <quantia> [descrição] - Registra uma despesa no cofre. A quantia deve ser um número, e a descrição é opcional.\n' +
        '/income <quantia> [descrição] - Registra uma receita no cofre. A quantia deve ser um número, e a descrição é opcional.\n' +
        '/edit <código> <nova quantia> - Edita uma transação existente no cofre. O código é o identificador da transação, e a nova quantia deve ser um número.\n' +
        '/summary - Exibe o resumo do cofre atual.\n' +
        '/join <token> - Conecta-se a um cofre existente usando o token.';
      await ctx.reply(commandsText, {
        parse_mode: 'Markdown',
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
          const [err, success] = await this.appService.handleVaultAction({
            actionId: payloadStr,
            chatId: ctx.chat.id.toString(),
          });
          if (err !== null) {
            await ctx.editMessageText(err);
            return;
          }
          await ctx.editMessageText(
            this.formatTransactionSuccessMessage(
              success.vault,
              success.transaction,
            ),
            { parse_mode: 'MarkdownV2' },
          );
        } catch {
          await ctx.editMessageText('Erro ao processar a ação.');
        }
        return;
      }
      return;
    });

    await this.telegraf.launch();
  }

  // Escapa apenas valores dinâmicos, não o texto fixo de formatação MarkdownV2
  private escapeMarkdownV2(text: string): string {
    return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
  }

  private formatTransactionSuccessMessage(
    vault: Vault,
    transaction: Transaction,
  ): string {
    const valor = this.escapeMarkdownV2(
      Math.abs(transaction.amount).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      }),
    );
    const saldo = this.escapeMarkdownV2(
      vault.getBalance().toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
      }),
    );
    const tipo = transaction.amount > 0 ? 'Receita' : 'Despesa';
    const emoji = transaction.amount > 0 ? '🟢' : '🔴';
    const desc = transaction.description
      ? `\n*Descrição:* ${this.escapeMarkdownV2(transaction.description)}`
      : '';
    return (
      `${emoji} *${tipo} registrada com sucesso\\!*\n\n` +
      `*Valor:* ${valor}${desc}\n` +
      `*Saldo atual:* ${saldo}`
    );
  }
  private formatVault(vault: Vault): string {
    const balance = vault.getBalance().toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    });

    let text = `💰 Cofre\n`;
    text += `Token: ${this.escapeMarkdownV2(vault.token)}\n`;
    text += `Criado em: ${this.escapeMarkdownV2(vault.createdAt.toLocaleDateString('pt-BR'))}\n`;
    text += `Saldo atual: ${this.escapeMarkdownV2(balance)}\n\n`;
    if (vault.entries.length === 0) {
      text += 'Nenhuma transação registrada\\.';
    } else {
      text += '*Transações:*\n';
      for (const entry of vault.entries) {
        const t = entry.transaction;
        const valor = Math.abs(t.amount).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        const data = t.createdAt.toLocaleDateString('pt-BR');
        text += `• \`#${this.escapeMarkdownV2(t.code)}\` \\| ${this.escapeMarkdownV2(valor)} \\| ${this.escapeMarkdownV2(data)} \\| ${t.description ? this.escapeMarkdownV2(t.description) : '\\-'}\n`;
      }
    }
    return text;
  }
}
