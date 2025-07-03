import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { RepositoriesModule } from './repositories/repositories.module';

@Module({})
export class ChatModule {
  static register(config: 'in-memory' | 'sqlite') {
    return {
      module: ChatModule,
      imports: [RepositoriesModule.register(config)],
      providers: [ChatService],
      exports: [ChatService],
    };
  }
}
