import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { MigrationService } from './migration-service';

export const SQLITE_DATABASE = 'SQLITE_DATABASE';

@Module({
  providers: [
    {
      provide: SQLITE_DATABASE,
      useFactory: (configService: ConfigService) => {
        const db = new Database(
          configService.getOrThrow<string>('SQLITE_DATABASE_URL'),
          {
            verbose: console.log,
          },
        );
        db.pragma('journal_mode = WAL');
        MigrationService.migrate(db);
        console.log('SQLite database initialized successfully.');
        return db;
      },
      inject: [ConfigService],
    },
  ],
  exports: [SQLITE_DATABASE],
})
export class SqliteModule {}
