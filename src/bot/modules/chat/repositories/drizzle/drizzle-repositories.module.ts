import { Module } from '@nestjs/common';
import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { ChatRepository } from '../chat.repository';
import { ChatDrizzleRepository } from './chat-drizzle.repository';

@Module({
  imports: [PersistenceModule.register('drizzle')],
  providers: [
    {
      provide: ChatRepository,
      useClass: ChatDrizzleRepository,
    },
  ],
  exports: [ChatRepository],
})
export class DrizzleRepositoriesModule {}
