import { Module } from '@nestjs/common';
import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { ImportBatchRepository } from '../import-batch.repository';
import { ImportEntryRepository } from '../import-entry.repository';
import { DuplicateDismissalRepository } from '../duplicate-dismissal.repository';
import { DuplicateDismissalDrizzleRepository } from './duplicate-dismissal-drizzle.repository';
import { ImportBatchDrizzleRepository } from './import-batch-drizzle.repository';
import { ImportEntryDrizzleRepository } from './import-entry-drizzle.repository';

@Module({
  imports: [PersistenceModule.register('drizzle')],
  providers: [
    { provide: ImportBatchRepository, useClass: ImportBatchDrizzleRepository },
    { provide: ImportEntryRepository, useClass: ImportEntryDrizzleRepository },
    {
      provide: DuplicateDismissalRepository,
      useClass: DuplicateDismissalDrizzleRepository,
    },
  ],
  exports: [
    ImportBatchRepository,
    ImportEntryRepository,
    DuplicateDismissalRepository,
  ],
})
export class ImportDrizzleRepositoriesModule {}
