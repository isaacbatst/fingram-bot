import { Module } from '@nestjs/common';
import { AgentModule } from '../shared/ai/agent.module';
import { VaultAgentController } from './vault-agent.controller';
import { VaultAgentService } from './vault-agent.service';
import { VaultModule } from './vault.module';

@Module({})
export class VaultAgentModule {
  static register() {
    return {
      module: VaultAgentModule,
      imports: [VaultModule.register(), AgentModule.register()],
      controllers: [VaultAgentController],
      providers: [VaultAgentService],
      exports: [VaultAgentService],
    };
  }
}
