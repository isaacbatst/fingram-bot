import { Module } from '@nestjs/common';
import { RepositoriesModule } from '@/shared/persistence/repositories.module';
import { VaultInMemoryRepositoriesModule } from './repositories/in-memory/in-memory-repositories.module';
import { VaultSqliteRepositoriesModule } from './repositories/sqlite/sqlite-repositories.module';
import { VaultDrizzleRepositoriesModule } from './repositories/drizzle/drizzle-repositories.module';
import { VaultAccessTokenGuard } from './vault-access-token.guard';
import { VaultAuthService } from './vault-auth.service';

@Module({})
export class VaultAuthModule {
  static register() {
    return {
      module: VaultAuthModule,
      imports: [
        RepositoriesModule.forFeature({
          sqlite: VaultSqliteRepositoriesModule,
          'in-memory': VaultInMemoryRepositoriesModule,
          drizzle: VaultDrizzleRepositoriesModule,
        }),
      ],
      providers: [VaultAuthService, VaultAccessTokenGuard],
      exports: [VaultAuthService, VaultAccessTokenGuard],
    };
  }
}
