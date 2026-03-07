import { Module } from '@nestjs/common';
import { RepositoriesModule } from '@/shared/persistence/repositories.module';
import { PlanDrizzleRepositoriesModule } from './repositories/drizzle/drizzle-repositories.module';
import { PlanInMemoryRepositoriesModule } from './repositories/in-memory/in-memory-repositories.module';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { VaultAuthModule } from '@/vault/vault-auth.module';

@Module({})
export class PlanModule {
  static register() {
    return {
      module: PlanModule,
      imports: [
        RepositoriesModule.forFeature({
          sqlite: PlanInMemoryRepositoriesModule,
          'in-memory': PlanInMemoryRepositoriesModule,
          drizzle: PlanDrizzleRepositoriesModule,
        }),
        VaultAuthModule.register(),
      ],
      controllers: [PlanController],
      providers: [PlanService],
      exports: [PlanService],
    };
  }
}
