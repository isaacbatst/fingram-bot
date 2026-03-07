import { Module } from '@nestjs/common';
import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { PlanRepository } from '../plan.repository';
import { PlanDrizzleRepository } from './plan-drizzle.repository';

@Module({
  imports: [PersistenceModule.register('drizzle')],
  providers: [
    {
      provide: PlanRepository,
      useClass: PlanDrizzleRepository,
    },
  ],
  exports: [PlanRepository],
})
export class PlanDrizzleRepositoriesModule {}
