import { Module } from '@nestjs/common';
import { BotModule } from './bot/bot.module';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RepositoriesModule } from './shared/persistence/repositories.module';
import { ImportModule } from './vault/import.module';
import { PlanModule } from './plan/plan.module';
import { McpModule } from './mcp/mcp.module';

@Module({})
export class AppModule {
  static register(config: { persistence: 'in-memory' | 'sqlite' | 'drizzle' }) {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        RepositoriesModule.forRoot(config.persistence),
        EventEmitterModule.forRoot(),
        BotModule.register(),
        ImportModule.register(),
        PlanModule.register(),
        McpModule.register(),
      ],
      controllers: [AppController],
    };
  }
}
