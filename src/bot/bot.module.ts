import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import { TelegramHandler } from './telegram.handler';
import { VaultModule } from '@/vault/vault.module';
import { BotService } from './bot.service';
import { ChatService } from './chat.service';
import { RepositoriesModule } from './repositories/repositories.module';

@Module({
  imports: [VaultModule, RepositoriesModule.register('in-memory')],
  providers: [
    TelegramHandler,
    BotService,
    ChatService,
    {
      provide: Telegraf,
      useFactory: (configService: ConfigService) => {
        const token = configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
        return new Telegraf(token);
      },
      inject: [ConfigService],
    },
  ],
})
export class BotModule {}
