import { Module } from '@nestjs/common';
import { ChatRepository } from '../chat.repository';
import { ChatSqliteRepository } from './chat-sqlite.repository';

@Module({
  providers: [
    {
      provide: ChatRepository,
      useClass: ChatSqliteRepository,
    },
  ],
  exports: [ChatRepository],
})
export class SqliteModule {}
