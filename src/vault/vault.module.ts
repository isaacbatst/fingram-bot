import { AiModule } from '@/shared/ai/ai.module';
import { Module } from '@nestjs/common';
import { RepositoriesModule } from './repositories/repositories.module';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { VaultAuthService } from './vault-auth.service';
import { VaultAccessTokenGuard } from './vault-access-token.guard';

@Module({})
export class VaultModule {
  static register(config: 'in-memory' | 'sqlite') {
    return {
      module: VaultModule,
      imports: [AiModule, RepositoriesModule.register(config)],
      controllers: [VaultController],
      providers: [VaultService, VaultAuthService, VaultAccessTokenGuard],
      exports: [VaultService, VaultAuthService, VaultAccessTokenGuard],
    };
  }
}
