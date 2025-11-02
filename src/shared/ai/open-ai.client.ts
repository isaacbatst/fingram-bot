import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class OpenAiClient {
  openAi: OpenAI;
  apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.getOrThrow<string>('OPEN_AI_API_KEY');
    this.openAi = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('OPEN_AI_API_KEY'),
      //  5 min timeout for requests
      timeout: 5 * 60 * 1000,
    });
  }
}
