import { Module } from '@nestjs/common';
import { SqliteModule } from './sqlite/sqlite.module';
import { InMemoryModule } from './in-memory/in-memory.module';
import { DrizzleModule } from './drizzle/drizzle.module';

@Module({})
export class PersistenceModule {
  static register(config: 'in-memory' | 'sqlite' | 'drizzle') {
    if (config === 'sqlite') {
      return {
        module: PersistenceModule,
        imports: [SqliteModule],
        exports: [SqliteModule],
      };
    }
    if (config === 'drizzle') {
      return {
        module: PersistenceModule,
        imports: [DrizzleModule],
        exports: [DrizzleModule],
      };
    }
    return {
      module: PersistenceModule,
      imports: [InMemoryModule],
      exports: [InMemoryModule],
    };
  }
}
