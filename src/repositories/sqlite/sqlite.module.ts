import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { MigrationService } from './schema-service';

const SQLITE_DB = 'SQLITE_DB';

@Module({
  providers: [
    {
      provide: SQLITE_DB,
      useFactory: (configService: ConfigService) => {
        const db = new Database(
          configService.getOrThrow<string>('SQLITE_DATABASE_URL'),
          {
            verbose: console.log,
          },
        );
        db.pragma('journal_mode = WAL');
        MigrationService.run(db);
        return db;
      },
      inject: [ConfigService],
    },
  ],
})
export class SqliteModule {}
