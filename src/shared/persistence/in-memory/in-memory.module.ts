import { Module } from '@nestjs/common';
import { InMemoryStore } from '@/shared/persistence/in-memory/in-memory-store';

@Module({
  providers: [InMemoryStore],
  exports: [InMemoryStore],
})
export class InMemoryModule {}
