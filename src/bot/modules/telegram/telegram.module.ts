import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import { TelegrafStarter } from './telegraf-starter';

@Module({
  providers: [
    {
      provide: Telegraf,
      useFactory: (configService: ConfigService) => {
        const token = configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
        return new Telegraf(token);
      },
      inject: [ConfigService],
    },
    TelegrafStarter,
  ],
  exports: [Telegraf],
})
export class TelegramModule {}
