import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { Module } from '@nestjs/common';
import { ChatRepository } from '../chat.repository';
import { ChatInMemoryRepository } from './chat-in-memory.repository';

@Module({
  imports: [PersistenceModule.register('in-memory')],
  providers: [
    {
      provide: ChatRepository,
      useClass: ChatInMemoryRepository,
    },
  ],
  exports: [ChatRepository],
})
export class InMemoryRepositoriesModule {}
