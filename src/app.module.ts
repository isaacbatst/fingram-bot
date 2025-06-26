import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { TelegrafModule } from './bot/telegraf.module';
import { Telegraf } from 'telegraf';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TelegrafModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const token = configService.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
        return new Telegraf(token);
      },
    }),
  ],
  providers: [AppService],
})
export class AppModule { }
