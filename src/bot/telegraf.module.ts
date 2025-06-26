import { Module } from '@nestjs/common';
import { Telegraf } from 'telegraf';

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
      ],
      exports: [Telegraf],
    };
  }
}
