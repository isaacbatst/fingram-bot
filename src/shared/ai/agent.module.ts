import { Module } from '@nestjs/common';
import { OpenAiAgentService } from './open-ai-agent.service';
import { OpenAiClient } from './open-ai.client';
import { VaultModule } from '../../vault/vault.module';

@Module({})
export class AgentModule {
  static register() {
    return {
      module: AgentModule,
      imports: [VaultModule.register()],
      providers: [OpenAiAgentService, OpenAiClient],
      exports: [OpenAiAgentService],
    };
  }
}
