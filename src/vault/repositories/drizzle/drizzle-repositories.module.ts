import { Module } from '@nestjs/common';
import { BoxRepository } from '../box.repository';
import { CategoryRepository } from '../category.repository';
import { CategoryDrizzleRepository } from './category-drizzle.repository';
import { TransactionRepository } from '../transaction.repository';
import { TransactionDrizzleRepository } from './transaction-drizzle.repository';
import { VaultRepository } from '../vault.repository';
import { VaultDrizzleRepository } from './vault-drizzle.repository';
import { ActionRepository } from '../action.repository';
import { ActionDrizzleRepository } from './action-drizzle.repository';
import { BoxDrizzleRepository } from './box-drizzle.repository';
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
    {
      provide: BoxRepository,
      useClass: BoxDrizzleRepository,
    },
  ],
  exports: [
    CategoryRepository,
    TransactionRepository,
    VaultRepository,
    ActionRepository,
    BoxRepository,
  ],
})
export class VaultDrizzleRepositoriesModule {}
