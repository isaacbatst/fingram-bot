import { VaultModule } from '@/vault/vault.module';
import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { ChatModule } from './modules/chat/chat.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TelegramHandler } from './telegram.handler';

@Module({})
export class BotModule {
  static register() {
    return {
      module: BotModule,
      imports: [VaultModule.register(), ChatModule.register(), TelegramModule],
      providers: [TelegramHandler, BotService],
    };
  }
}
