import { Module } from '@nestjs/common';
import { InMemoryRepositoriesModule } from './in-memory/in-memory-repositories.module';

@Module({})
export class RepositoriesModule {
  static register(config: 'in-memory' | 'sqlite') {
    const modulesPerConfig: Record<string, any> = {
      sqlite: null,
      'in-memory': InMemoryRepositoriesModule,
    };

    if (!modulesPerConfig[config]) {
      throw new Error(`Unsupported repository configuration: ${config}`);
    }

    return {
      module: RepositoriesModule,
      imports: [modulesPerConfig[config]],
      exports: [modulesPerConfig[config]],
    };
  }
}
