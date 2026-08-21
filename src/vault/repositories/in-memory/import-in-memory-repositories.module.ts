import { Module } from '@nestjs/common';
import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { ImportBatchRepository } from '../import-batch.repository';
import { ImportEntryRepository } from '../import-entry.repository';
import { ImportBatchInMemoryRepository } from './import-batch-in-memory.repository';
import { ImportEntryInMemoryRepository } from './import-entry-in-memory.repository';

@Module({
  imports: [PersistenceModule.register('in-memory')],
  providers: [
    { provide: ImportBatchRepository, useClass: ImportBatchInMemoryRepository },
    { provide: ImportEntryRepository, useClass: ImportEntryInMemoryRepository },
  ],
  exports: [ImportBatchRepository, ImportEntryRepository],
})
export class ImportInMemoryRepositoriesModule {}
