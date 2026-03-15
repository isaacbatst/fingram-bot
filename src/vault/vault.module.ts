import { Module } from '@nestjs/common';
import { ChatModule } from '../bot/modules/chat/chat.module';
import { RepositoriesModule } from '../shared/persistence/repositories.module';
import { VaultInMemoryRepositoriesModule } from './repositories/in-memory/in-memory-repositories.module';
import { VaultSqliteRepositoriesModule } from './repositories/sqlite/sqlite-repositories.module';
import { VaultDrizzleRepositoriesModule } from './repositories/drizzle/drizzle-repositories.module';
import { VaultQueryModule } from './shared/vault-query.module';
import { PlanQueryModule } from '@/plan/shared/plan-query.module';
import { VaultAuthModule } from './vault-auth.module';
import { VaultWebController } from './vault-web.controller';
import { VaultWebService } from './vault-web.service';
import { VaultService } from './vault.service';
import { AiModule } from '../shared/ai/ai.module';

@Module({})
export class VaultModule {
  static register() {
    return {
      module: VaultModule,
      imports: [
        AiModule.register(),
        RepositoriesModule.forFeature({
          sqlite: VaultSqliteRepositoriesModule,
          'in-memory': VaultInMemoryRepositoriesModule,
          drizzle: VaultDrizzleRepositoriesModule,
        }),
        VaultQueryModule.register(),
        PlanQueryModule.register(),
        ChatModule.register(),
        VaultAuthModule.register(),
      ],
      controllers: [VaultWebController],
      providers: [VaultService, VaultWebService],
      exports: [
        VaultService,
        VaultWebService,
        VaultAuthModule,
        RepositoriesModule,
      ],
    };
  }
}
