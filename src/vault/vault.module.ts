import { Module } from '@nestjs/common';
import { RepositoriesModule } from './repositories/repositories.module';
import { VaultService } from './vault.service';
import { AiModule } from '@/ai/ai.module';

@Module({
  imports: [AiModule, RepositoriesModule.register('in-memory')],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
