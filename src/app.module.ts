import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AppService } from './app.service';
import { RepositoriesModule } from './repositories/repositories.module';
import { TelegramHandler } from './telegram.handler';
import { BotModule } from './bot/bot.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AiModule,
    BotModule,
    RepositoriesModule.forRoot('in-memory'),
  ],
  providers: [AppService, TelegramHandler],
})
export class AppModule {}
