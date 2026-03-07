import { Module } from '@nestjs/common';
import { PlanRepository } from '../plan.repository';
import { PlanInMemoryRepository } from './plan-in-memory.repository';

@Module({
  providers: [
    {
      provide: PlanRepository,
      useClass: PlanInMemoryRepository,
    },
  ],
  exports: [PlanRepository],
})
export class PlanInMemoryRepositoriesModule {}
