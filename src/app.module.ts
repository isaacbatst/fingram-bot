import { Module } from '@nestjs/common';
import { BotModule } from './bot/bot.module';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({})
export class AppModule {
  static register(config: 'in-memory' | 'sqlite') {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        EventEmitterModule.forRoot(),
        BotModule.register(config),
      ],
      controllers: [AppController],
    };
  }
}
