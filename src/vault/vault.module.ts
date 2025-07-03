import { AiModule } from '@/shared/ai/ai.module';
import { Module } from '@nestjs/common';
import { RepositoriesModule } from './repositories/repositories.module';
import { VaultService } from './vault.service';

@Module({})
export class VaultModule {
  static register(config: 'in-memory' | 'sqlite') {
    return {
      module: VaultModule,
      imports: [AiModule, RepositoriesModule.register(config)],
      providers: [VaultService],
      exports: [VaultService],
    };
  }
}
