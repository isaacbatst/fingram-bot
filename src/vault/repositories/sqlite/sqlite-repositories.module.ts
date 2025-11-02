import { Module } from '@nestjs/common';
import { CategoryRepository } from '../category.repository';
import { CategorySqliteRepository } from './category-sqlite.repository';
import { TransactionRepository } from '../transaction.repository';
import { TransactionSqliteRepository } from './transaction-sqlite.repository';
import { VaultRepository } from '../vault.repository';
import { VaultSqliteRepository } from './vault-sqlite.repository';
import { ActionRepository } from '../action.repository';
import { ActionSqliteRepository } from './action-sqlite.repository';
import { PersistenceModule } from '@/shared/persistence/persistence.module';

@Module({
  imports: [PersistenceModule.register('sqlite')],
  providers: [
    {
      provide: CategoryRepository,
      useClass: CategorySqliteRepository,
    },
    {
      provide: TransactionRepository,
      useClass: TransactionSqliteRepository,
    },
    {
      provide: VaultRepository,
      useClass: VaultSqliteRepository,
    },
    {
      provide: ActionRepository,
      useClass: ActionSqliteRepository,
    },
  ],
  exports: [
    CategoryRepository,
    TransactionRepository,
    VaultRepository,
    ActionRepository,
  ],
})
export class VaultSqliteRepositoriesModule {}
