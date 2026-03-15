import { Module } from '@nestjs/common';
import { BoxRepository } from '@/vault/repositories/box.repository';
import { BoxInMemoryRepository } from '@/vault/repositories/in-memory/box-in-memory.repository';
import { TransactionRepository } from '@/vault/repositories/transaction.repository';
import { TransactionInMemoryRepository } from '@/vault/repositories/in-memory/transaction-in-memory.repository';

@Module({
  providers: [
    { provide: BoxRepository, useClass: BoxInMemoryRepository },
    { provide: TransactionRepository, useClass: TransactionInMemoryRepository },
  ],
  exports: [BoxRepository, TransactionRepository],
})
export class VaultQueryInMemoryRepositoriesModule {}
