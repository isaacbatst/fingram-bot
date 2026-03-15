import { Module } from '@nestjs/common';
import { PlanQueryModule } from './shared/plan-query.module';
import { VaultQueryModule } from '@/vault/shared/vault-query.module';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { VaultAuthModule } from '@/vault/vault-auth.module';

@Module({})
export class PlanModule {
  static register() {
    return {
      module: PlanModule,
      imports: [
        PlanQueryModule.register(),
        VaultQueryModule.register(),
        VaultAuthModule.register(),
      ],
      controllers: [PlanController],
      providers: [PlanService],
      exports: [PlanService],
    };
  }
}
