import { Module } from '@nestjs/common';
import { InMemoryRepositoriesModule } from './in-memory/in-memory-repositories.module';
import { SqliteRepositoriesModule } from './sqlite/sqlite-repositories.module';

@Module({})
export class RepositoriesModule {
  static register(config: 'in-memory' | 'sqlite') {
    const modulePerConfig = {
      sqlite: SqliteRepositoriesModule,
      'in-memory': InMemoryRepositoriesModule,
    };

    if (!modulePerConfig[config]) {
      throw new Error(`Unsupported repository configuration: ${config}`);
    }

    return {
      module: RepositoriesModule,
      imports: [modulePerConfig[config]],
      exports: [modulePerConfig[config]],
    };
  }
}
