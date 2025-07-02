import { Module } from '@nestjs/common';
import { InMemoryRepositoriesModule } from './in-memory/in-memory-repositories.module';

@Module({})
export class RepositoriesModule {
  static forRoot(config: 'in-memory' | 'sqlite') {
    if (config === 'in-memory') {
      return {
        module: RepositoriesModule,
        imports: [InMemoryRepositoriesModule],
        exports: [InMemoryRepositoriesModule],
      };
    }

    throw new Error(`Unsupported repository configuration: ${config}`);
  }
}
