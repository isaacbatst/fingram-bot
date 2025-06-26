import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { TelegrafModule } from './bot/telegraf.module';
import { Telegraf } from 'telegraf';
import { ChatRepository } from './repositories/chat.repository';
import { ChatInMemoryRepository } from './repositories/chat-in-memory.repository';
import { VaultRepository } from './repositories/vault.repository';
import { VaultInMemoryRepository } from './repositories/vault-in-memory.repository';
import { TelegramHandler } from './telegram.handler';
import { AiModule } from './ai/ai.module';
import { ActionRepository } from './repositories/action.repository';
import { ActionInMemoryRepository } from './repositories/action-in-memory.repository';
import { CategoryRepository } from './repositories/category.repository';
import { CategoryInMemoryRepository } from './repositories/category-in-memory.repository';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TelegrafModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const token = configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
        return new Telegraf(token);
      },
    }),
    AiModule,
  ],
  providers: [
    AppService,
    TelegramHandler,
    {
      provide: ChatRepository,
      useClass: ChatInMemoryRepository,
    },
    {
      provide: VaultRepository,
      useClass: VaultInMemoryRepository,
    },
    {
      provide: ActionRepository,
      useClass: ActionInMemoryRepository,
    },
    {
      provide: CategoryRepository,
      useClass: CategoryInMemoryRepository,
    },
  ],
})
export class AppModule {}
