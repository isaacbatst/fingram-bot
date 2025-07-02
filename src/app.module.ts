import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotModule } from './bot/bot.module';
import { VaultModule } from './vault/vault.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BotModule,
    VaultModule,
  ],
})
export class AppModule {}
