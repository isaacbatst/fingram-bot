import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { OpenAiClient } from './open-ai.client';
import { OpenAiService } from './open-ai.service';
@Module({})
export class AiModule {
  static register() {
    return {
      module: AiModule,
      providers: [
        {
          provide: AiService,
          useClass: OpenAiService,
        },
        {
          provide: OpenAiClient,
          useClass: OpenAiClient,
        },
      ],
      exports: [AiService],
    };
  }
}
