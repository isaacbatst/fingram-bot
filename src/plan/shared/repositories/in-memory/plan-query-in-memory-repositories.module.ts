import { Module } from '@nestjs/common';
import { PlanRepository } from '@/plan/repositories/plan.repository';
import { PlanInMemoryRepository } from '@/plan/repositories/in-memory/plan-in-memory.repository';
import { AllocationRepository } from '../allocation.repository';
import { AllocationInMemoryRepository } from './allocation-in-memory.repository';

@Module({
  providers: [
    { provide: PlanRepository, useClass: PlanInMemoryRepository },
    { provide: AllocationRepository, useClass: AllocationInMemoryRepository },
  ],
  exports: [PlanRepository, AllocationRepository],
})
export class PlanQueryInMemoryRepositoriesModule {}
