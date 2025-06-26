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
  ],
})
export class AppModule {}
