import { Module } from '@nestjs/common';
import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { ChatRepository } from '../chat.repository';
import { ChatSqliteRepository } from './chat-sqlite.repository';

@Module({
  imports: [PersistenceModule.register('sqlite')],
  providers: [
    {
      provide: ChatRepository,
      useClass: ChatSqliteRepository,
    },
  ],
  exports: [ChatRepository],
})
export class SqliteRepositoriesModule {}
