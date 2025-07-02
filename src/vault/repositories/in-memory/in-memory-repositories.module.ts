import { Module } from '@nestjs/common';
import { ActionRepository } from '../action.repository';
import { CategoryRepository } from '../category.repository';
import { VaultRepository } from '../vault.repository';
import { ActionInMemoryRepository } from './action-in-memory.repository';
import { CategoryInMemoryRepository } from './category-in-memory.repository';
import { InMemoryStore } from './in-memory-store';
import { VaultInMemoryRepository } from './vault-in-memory.repository';
import { TransactionRepository } from '../transaction.repository';
import { TransactionInMemoryRepository } from './transaction-in-memory.repository';

@Module({
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
    InMemoryStore,
  ],
  exports: [
    VaultRepository,
    ActionRepository,
    CategoryRepository,
    TransactionRepository,
  ],
})
export class InMemoryRepositoriesModule {}
