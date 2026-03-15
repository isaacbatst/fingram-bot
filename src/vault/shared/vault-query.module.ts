import { DynamicModule, Module } from '@nestjs/common';
import { RepositoriesModule } from '@/shared/persistence/repositories.module';
import { VaultQueryDrizzleRepositoriesModule } from './repositories/drizzle/vault-query-drizzle-repositories.module';
import { VaultQueryInMemoryRepositoriesModule } from './repositories/in-memory/vault-query-in-memory-repositories.module';
import { VaultQueryService } from './vault-query.service';
import { BoxRepository } from '@/vault/repositories/box.repository';
import { TransactionRepository } from '@/vault/repositories/transaction.repository';

@Module({})
export class VaultQueryModule {
  static register(): DynamicModule {
    return {
      module: VaultQueryModule,
      imports: [
        RepositoriesModule.forFeature({
          drizzle: VaultQueryDrizzleRepositoriesModule,
          'in-memory': VaultQueryInMemoryRepositoriesModule,
          sqlite: VaultQueryInMemoryRepositoriesModule,
        }),
      ],
      providers: [VaultQueryService],
      exports: [VaultQueryService, BoxRepository, TransactionRepository],
    };
  }
}
