import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { Module } from '@nestjs/common';
import { ActionRepository } from '../action.repository';
import { CategoryRepository } from '../category.repository';
import { VaultRepository } from '../vault.repository';
import { ActionInMemoryRepository } from './action-in-memory.repository';
import { CategoryInMemoryRepository } from './category-in-memory.repository';
import { VaultInMemoryRepository } from './vault-in-memory.repository';

@Module({
  imports: [PersistenceModule.register('in-memory')],
  providers: [
    {
      provide: VaultRepository,
      useClass: VaultInMemoryRepository,
    },
    {
      provide: ActionRepository,
      useClass: ActionInMemoryRepository,
    },
    {
      provide: CategoryRepository,
      useClass: CategoryInMemoryRepository,
    },
  ],
  exports: [
    VaultRepository,
    ActionRepository,
    CategoryRepository,
  ],
})
export class VaultInMemoryRepositoriesModule {}
