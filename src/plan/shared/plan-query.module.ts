import { DynamicModule, Module } from '@nestjs/common';
import { RepositoriesModule } from '@/shared/persistence/repositories.module';
import { PlanQueryDrizzleRepositoriesModule } from './repositories/drizzle/plan-query-drizzle-repositories.module';
import { PlanQueryInMemoryRepositoriesModule } from './repositories/in-memory/plan-query-in-memory-repositories.module';
import { PlanQueryService } from './plan-query.service';
import { PlanRepository } from '@/plan/repositories/plan.repository';
import { AllocationRepository } from './repositories/allocation.repository';

@Module({})
export class PlanQueryModule {
  static register(): DynamicModule {
    return {
      module: PlanQueryModule,
      imports: [
        RepositoriesModule.forFeature({
          drizzle: PlanQueryDrizzleRepositoriesModule,
          'in-memory': PlanQueryInMemoryRepositoriesModule,
          sqlite: PlanQueryInMemoryRepositoriesModule,
        }),
      ],
      providers: [PlanQueryService],
      exports: [PlanQueryService, PlanRepository, AllocationRepository],
    };
  }
}
