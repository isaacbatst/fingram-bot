import { Module } from '@nestjs/common';
import { ChatRepository } from '../chat.repository';
import { ChatInMemoryRepository } from './chat-in-memory.repository';
import { InMemoryStore } from './in-memory-store';

@Module({
  providers: [
    {
      provide: ChatRepository,
      useClass: ChatInMemoryRepository,
    },
    InMemoryStore,
  ],
  exports: [ChatRepository],
})
export class InMemoryRepositoriesModule {}
