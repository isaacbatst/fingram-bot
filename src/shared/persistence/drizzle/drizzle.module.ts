import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { neon } from '@neondatabase/serverless';
import {
  drizzle as drizzleNeon,
  NeonHttpDatabase,
} from 'drizzle-orm/neon-http';
import {
  drizzle as drizzleNode,
  NodePgDatabase,
} from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { CATEGORIES_SEED } from '../seed';

export const DRIZZLE_DATABASE = 'DRIZZLE_DATABASE';
export const DRIZZLE_IS_NEON = 'DRIZZLE_IS_NEON';
export const DRIZZLE_POOL = 'DRIZZLE_POOL';

export type DrizzleDatabase =
  | NeonHttpDatabase<typeof schema>
  | NodePgDatabase<typeof schema>;

@Module({
  providers: [
    {
      provide: DRIZZLE_IS_NEON,
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
        return databaseUrl.includes('neon.tech');
      },
      inject: [ConfigService],
    },
    {
      provide: DRIZZLE_POOL,
      useFactory: (configService: ConfigService, isNeon: boolean) => {
        if (isNeon) return null;
        const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
        return new Pool({ connectionString: databaseUrl });
      },
      inject: [ConfigService, DRIZZLE_IS_NEON],
    },
    {
      provide: DRIZZLE_DATABASE,
      useFactory: async (
        configService: ConfigService,
        isNeon: boolean,
        pool: Pool | null,
      ) => {
        let db: DrizzleDatabase;

        if (isNeon) {
          const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
          const sql = neon(databaseUrl);
          db = drizzleNeon(sql, { schema });
        } else {
          db = drizzleNode(pool!, { schema });
        }

        // Seed categories
        console.log('Seeding categories...');
        for (const cat of CATEGORIES_SEED) {
          await db
            .insert(schema.category)
            .values({
              id: cat.id,
              name: cat.name,
              code: cat.code,
              description: cat.description,
              transactionType: cat.transaction_type,
            })
            .onConflictDoNothing();
        }
        console.log('Drizzle database initialized successfully.');

        return db;
      },
      inject: [ConfigService, DRIZZLE_IS_NEON, DRIZZLE_POOL],
    },
  ],
  exports: [DRIZZLE_DATABASE, DRIZZLE_IS_NEON],
})
export class DrizzleModule implements OnModuleDestroy {
  constructor(@Inject(DRIZZLE_POOL) private readonly pool: Pool | null) {}

  async onModuleDestroy() {
    await this.pool?.end();
  }
}
