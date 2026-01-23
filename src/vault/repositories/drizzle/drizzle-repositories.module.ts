import { Module } from '@nestjs/common';
import { CategoryRepository } from '../category.repository';
import { CategoryDrizzleRepository } from './category-drizzle.repository';
import { TransactionRepository } from '../transaction.repository';
import { TransactionDrizzleRepository } from './transaction-drizzle.repository';
import { VaultRepository } from '../vault.repository';
import { VaultDrizzleRepository } from './vault-drizzle.repository';
import { ActionRepository } from '../action.repository';
import { ActionDrizzleRepository } from './action-drizzle.repository';
import { PersistenceModule } from '@/shared/persistence/persistence.module';

@Module({
  imports: [PersistenceModule.register('drizzle')],
  providers: [
    {
      provide: CategoryRepository,
      useClass: CategoryDrizzleRepository,
    },
    {
      provide: TransactionRepository,
      useClass: TransactionDrizzleRepository,
    },
    {
      provide: VaultRepository,
      useClass: VaultDrizzleRepository,
    },
    {
      provide: ActionRepository,
      useClass: ActionDrizzleRepository,
    },
  ],
  exports: [
    CategoryRepository,
    TransactionRepository,
    VaultRepository,
    ActionRepository,
  ],
})
export class VaultDrizzleRepositoriesModule {}
