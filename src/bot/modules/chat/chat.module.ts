import { Module } from '@nestjs/common';
import { InMemoryRepositoriesModule } from './repositories/in-memory/in-memory-repositories.module';
import { ChatService } from './chat.service';

@Module({})
export class ChatModule {
  static register(config: 'in-memory' | 'sqlite') {
    const modulePerConfig: Record<string, any> = {
      sqlite: null,
      'in-memory': InMemoryRepositoriesModule,
    };

    if (!modulePerConfig[config]) {
      throw new Error(`Unsupported chat configuration: ${config}`);
    }

    return {
      module: ChatModule,
      providers: [ChatService],
      imports: [modulePerConfig[config]],
      exports: [ChatService],
    };
  }
}
