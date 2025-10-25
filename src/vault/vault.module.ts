import { AiModule } from '@/shared/ai/ai.module';
import { Module } from '@nestjs/common';
import { RepositoriesModule } from './repositories/repositories.module';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { VaultWebService } from './vault-web.service';
import { VaultAccessTokenGuard } from './vault-access-token.guard';
import { ChatModule } from '../bot/modules/chat/chat.module';

@Module({})
export class VaultModule {
  static register(config: 'in-memory' | 'sqlite') {
    return {
      module: VaultModule,
      imports: [
        AiModule,
        RepositoriesModule.register(config),
        ChatModule.register(config),
      ],
      controllers: [VaultController],
      providers: [VaultService, VaultWebService, VaultAccessTokenGuard],
      exports: [VaultService, VaultWebService, VaultAccessTokenGuard],
    };
  }
}
