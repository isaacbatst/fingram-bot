import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { neon } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import { CATEGORIES_SEED } from '../seed';

export const DRIZZLE_DATABASE = 'DRIZZLE_DATABASE';

export type DrizzleDatabase = NeonHttpDatabase<typeof schema>;

@Module({
  providers: [
    {
      provide: DRIZZLE_DATABASE,
      useFactory: async (configService: ConfigService) => {
        const sql = neon(configService.getOrThrow<string>('DATABASE_URL'));
        const db = drizzle(sql, { schema });

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
      inject: [ConfigService],
    },
  ],
  exports: [DRIZZLE_DATABASE],
})
export class DrizzleModule {}
