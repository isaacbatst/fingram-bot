import { Module } from '@nestjs/common';
import { ActionRepository } from '../action.repository';
import { CategoryRepository } from '../category.repository';
import { ChatRepository } from '../chat.repository';
import { VaultRepository } from '../vault.repository';
import { ActionInMemoryRepository } from './action-in-memory.repository';
import { CategoryInMemoryRepository } from './category-in-memory.repository';
import { ChatInMemoryRepository } from './chat-in-memory.repository';
import { VaultInMemoryRepository } from './vault-in-memory.repository';
import { InMemoryStore } from './in-memory-store';

@Module({
  providers: [
    {
      provide: ChatRepository,
      useClass: ChatInMemoryRepository,
    },
    {
      provide: VaultRepository,
      useClass: VaultInMemoryRepository,
    },
    {
      provide: ActionRepository,
      useClass: ActionInMemoryRepository,
    },
    {
      provide: CategoryRepository,
      useClass: CategoryInMemoryRepository,
    },
    InMemoryStore,
  ],
  exports: [
    ChatRepository,
    VaultRepository,
    ActionRepository,
    CategoryRepository,
  ],
})
export class InMemoryRepositoriesModule {}
