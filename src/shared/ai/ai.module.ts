import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { OpenAiService } from './open-ai.service';

@Module({
  providers: [
    {
      provide: AiService,
      useClass: OpenAiService,
    },
  ],
  exports: [AiService],
})
export class AiModule {}
