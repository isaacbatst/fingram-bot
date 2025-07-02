import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';

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
  ],
  exports: [Telegraf],
})
export class BotModule {}
