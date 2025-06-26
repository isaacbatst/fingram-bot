import { Module } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { TelegrafService } from './telegraf.service';

@Module({})
export class TelegrafModule {
  static forRootAsync({
    useFactory,
    inject,
  }: {
    useFactory: (...args: any[]) => Promise<Telegraf> | Telegraf;
    inject?: any[];
  }) {
    return {
      module: TelegrafModule,
      providers: [
        {
          provide: Telegraf,
          useFactory,
          inject,
        },
        TelegrafService,
      ],
    };
  }
}
