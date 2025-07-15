import { VaultModule } from '@/vault/vault.module';
import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { ChatModule } from './modules/chat/chat.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TelegramHandler } from './telegram.handler';
import { MiniappController } from './miniapp.controller';
import { MiniappService } from './miniapp.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Module({})
export class BotModule {
  static register(config: 'in-memory' | 'sqlite') {
    return {
      module: BotModule,
      imports: [
        VaultModule.register(config),
        ChatModule.register(config),
        TelegramModule,
        JwtModule.registerAsync({
          useFactory: (configService: ConfigService) => ({
            secret: configService.get<string>('JWT_SECRET') || 'default-secret',
            signOptions: { expiresIn: '1h' },
          }),
          inject: [ConfigService],
        }),
      ],
      controllers: [MiniappController],
      providers: [TelegramHandler, BotService, MiniappService],
    };
  }
}
