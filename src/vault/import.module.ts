import { DynamicModule, Module } from '@nestjs/common';
import { RepositoriesModule } from '@/shared/persistence/repositories.module';
import { VaultInMemoryRepositoriesModule } from './repositories/in-memory/in-memory-repositories.module';
import { VaultSqliteRepositoriesModule } from './repositories/sqlite/sqlite-repositories.module';
import { VaultDrizzleRepositoriesModule } from './repositories/drizzle/drizzle-repositories.module';
import { ImportDrizzleRepositoriesModule } from './repositories/drizzle/import-drizzle-repositories.module';
import { ImportInMemoryRepositoriesModule } from './repositories/in-memory/import-in-memory-repositories.module';
import { VaultQueryModule } from './shared/vault-query.module';
import { VaultAuthModule } from './vault-auth.module';
import { PlanQueryModule } from '@/plan/shared/plan-query.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { CardInvoiceService } from './card-invoice.service';
import { CardController, InvoiceController } from './invoice.controller';

@Module({})
export class ImportModule {
  static register(): DynamicModule {
    return {
      module: ImportModule,
      imports: [
        // VaultRepository (the aggregate the confirmed transactions are added to)
        RepositoriesModule.forFeature({
          drizzle: VaultDrizzleRepositoriesModule,
          'in-memory': VaultInMemoryRepositoriesModule,
          sqlite: VaultSqliteRepositoriesModule,
        }),
        // BoxRepository, for resolving the estrato bound to the account
        VaultQueryModule.register(),
        // VaultAuthService, required by VaultAccessTokenGuard on every route here
        VaultAuthModule.register(),
        // PlanQueryService: valida e sugere pagamento planejado na triagem
        PlanQueryModule.register(),
        // sqlite has no import implementation and is a legacy backend here, so it
        // falls back to in-memory — same choice VaultQueryModule already makes.
        RepositoriesModule.forFeature({
          drizzle: ImportDrizzleRepositoriesModule,
          'in-memory': ImportInMemoryRepositoriesModule,
          sqlite: ImportInMemoryRepositoriesModule,
        }),
      ],
      controllers: [ImportController, InvoiceController, CardController],
      providers: [ImportService, CardInvoiceService],
      exports: [ImportService, CardInvoiceService],
    };
  }
}
