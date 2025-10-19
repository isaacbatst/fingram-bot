import { VaultModule } from '@/vault/vault.module';
import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { ChatModule } from './modules/chat/chat.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TelegramHandler } from './telegram.handler';

@Module({})
export class BotModule {
  static register(config: 'in-memory' | 'sqlite') {
    return {
      module: BotModule,
      imports: [
        VaultModule.register(config),
        ChatModule.register(config),
        TelegramModule,
      ],
      providers: [TelegramHandler, BotService],
    };
  }
}
