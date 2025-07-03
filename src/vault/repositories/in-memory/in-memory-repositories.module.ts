import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { Module } from '@nestjs/common';
import { ActionRepository } from '../action.repository';
import { CategoryRepository } from '../category.repository';
import { TransactionRepository } from '../transaction.repository';
import { VaultRepository } from '../vault.repository';
import { ActionInMemoryRepository } from './action-in-memory.repository';
import { CategoryInMemoryRepository } from './category-in-memory.repository';
import { TransactionInMemoryRepository } from './transaction-in-memory.repository';
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
    {
      provide: TransactionRepository,
      useClass: TransactionInMemoryRepository,
    },
  ],
  exports: [
    VaultRepository,
    ActionRepository,
    CategoryRepository,
    TransactionRepository,
  ],
})
export class InMemoryRepositoriesModule {}
