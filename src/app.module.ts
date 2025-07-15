import { Module } from '@nestjs/common';
import { BotModule } from './bot/bot.module';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';

@Module({})
export class AppModule {
  static register(config: 'in-memory' | 'sqlite') {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        BotModule.register(config),
      ],
      controllers: [AppController],
    };
  }
}
