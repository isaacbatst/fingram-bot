import { Injectable } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { AppService } from './app.service';

@Injectable()
export class TelegramHandler {
  constructor(
    private telegraf: Telegraf,
    private appService: AppService,
  ) {}

  async onApplicationBootstrap() {
    this.telegraf.command('create', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const answer = await this.appService.createVault({ chatId });
      await ctx.reply(answer);
    });
    this.telegraf.command('join', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) {
        await ctx.reply('Uso: /join <token>');
        return;
      }
      const token = args[0];
      const [err, success] = await this.appService.joinVault({
        chatId,
        vaultToken: token,
      });
      await ctx.reply(err ?? success);
    });

    this.telegraf.command('income', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) {
        await ctx.reply('Uso: /omcp,e <quantia> [descrição]');
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
      await ctx.reply(err ?? success);
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
      await ctx.reply(err ?? success);
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
      await ctx.reply(err ?? success);
    });

    this.telegraf.command('summary', async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const vault = await this.appService.getVault({ chatId });
      await ctx.reply(vault.toString(), { parse_mode: 'Markdown' });
    });

    this.telegraf.command('help', async (ctx) => {
      const helpText = `
Ações disponíveis:
/expense <quantia> [descrição] - Registra uma despesa no cofre. A quantia deve ser um número, e a descrição é opcional.
/income <quantia> [descrição] - Registra uma receita no cofre. A quantia deve ser um número, e a descrição é opcional.
/edit <código> <nova quantia> - Edita uma transação existente no cofre. O código é o identificador da transação, e a nova quantia deve ser um número.
/summary - Exibe o resumo do cofre atual.
/help - Mostra esta mensagem de ajuda.
/join <token> - Conecta-se a um cofre existente usando o token.
`;
      await ctx.reply(helpText);
    });

    await this.telegraf.launch();
  }
}
