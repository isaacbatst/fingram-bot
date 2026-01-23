import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { RepositoriesModule } from '@/shared/persistence/repositories.module';
import { SqliteRepositoriesModule } from './repositories/sqlite/sqlite-repositores.module';
import { InMemoryRepositoriesModule } from './repositories/in-memory/in-memory-repositories.module';
import { DrizzleRepositoriesModule } from './repositories/drizzle/drizzle-repositories.module';

@Module({})
export class ChatModule {
  static register() {
    return {
      module: ChatModule,
      imports: [
        RepositoriesModule.forFeature({
          sqlite: SqliteRepositoriesModule,
          'in-memory': InMemoryRepositoriesModule,
          drizzle: DrizzleRepositoriesModule,
        }),
      ],
      providers: [ChatService],
      exports: [ChatService],
    };
  }
}
