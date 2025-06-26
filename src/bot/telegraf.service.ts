import { Injectable } from '@nestjs/common';
import { Telegraf } from 'telegraf';

@Injectable()
export class TelegrafService {
  constructor(private telegraf: Telegraf) {}

  async onApplicationBootstrap() {
    this.telegraf.command('oldschool', (ctx) => ctx.reply('Hellow'));
    this.telegraf.command('hipster', Telegraf.reply('λBot says: λB'));
    await this.telegraf.launch();
  }
}
