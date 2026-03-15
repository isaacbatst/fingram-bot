import { Module } from '@nestjs/common';
import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { BoxRepository } from '@/vault/repositories/box.repository';
import { BoxDrizzleRepository } from '@/vault/repositories/drizzle/box-drizzle.repository';
import { TransactionRepository } from '@/vault/repositories/transaction.repository';
import { TransactionDrizzleRepository } from '@/vault/repositories/drizzle/transaction-drizzle.repository';

@Module({
  imports: [PersistenceModule.register('drizzle')],
  providers: [
    { provide: BoxRepository, useClass: BoxDrizzleRepository },
    { provide: TransactionRepository, useClass: TransactionDrizzleRepository },
  ],
  exports: [BoxRepository, TransactionRepository],
})
export class VaultQueryDrizzleRepositoriesModule {}
