import { Module } from '@nestjs/common';
import { SqliteModule } from './sqlite/sqlite.module';
import { InMemoryModule } from './in-memory/in-memory.module';

@Module({})
export class PersistenceModule {
  static register(config: 'in-memory' | 'sqlite') {
    if (config === 'sqlite') {
      return {
        module: PersistenceModule,
        imports: [SqliteModule],
        exports: [SqliteModule],
      };
    }
    return {
      module: PersistenceModule,
      imports: [InMemoryModule],
      exports: [InMemoryModule],
    };
  }
}
