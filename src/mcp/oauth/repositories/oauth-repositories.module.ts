import { Module } from '@nestjs/common';
import { PersistenceModule } from '@/shared/persistence/persistence.module';
import { OAuthRepository } from '../oauth.repository';
import { OAuthDrizzleRepository } from './oauth-drizzle.repository';
import { OAuthInMemoryRepository } from './oauth-in-memory.repository';

@Module({
  imports: [PersistenceModule.register('drizzle')],
  providers: [{ provide: OAuthRepository, useClass: OAuthDrizzleRepository }],
  exports: [OAuthRepository],
})
export class OAuthDrizzleRepositoriesModule {}

@Module({
  providers: [{ provide: OAuthRepository, useClass: OAuthInMemoryRepository }],
  exports: [OAuthRepository],
})
export class OAuthInMemoryRepositoriesModule {}
