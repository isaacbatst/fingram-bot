import { Module } from '@nestjs/common';
import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { PlanRepository } from '@/plan/repositories/plan.repository';
import { PlanDrizzleRepository } from '@/plan/repositories/drizzle/plan-drizzle.repository';
import { AllocationRepository } from '../allocation.repository';
import { AllocationDrizzleRepository } from './allocation-drizzle.repository';

@Module({
  imports: [PersistenceModule.register('drizzle')],
  providers: [
    { provide: PlanRepository, useClass: PlanDrizzleRepository },
    { provide: AllocationRepository, useClass: AllocationDrizzleRepository },
  ],
  exports: [PlanRepository, AllocationRepository],
})
export class PlanQueryDrizzleRepositoriesModule {}
