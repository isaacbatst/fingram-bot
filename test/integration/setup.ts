import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '@/app.module';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from '@/shared/persistence/drizzle/schema';
import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';

let container: StartedPostgreSqlContainer;
let app: INestApplication;
let db: NodePgDatabase<typeof schema>;
let pool: Pool;

export async function startTestApp(): Promise<{
  app: INestApplication;
  db: NodePgDatabase<typeof schema>;
}> {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();

  const connectionString = container.getConnectionUri();
  process.env.DATABASE_URL = connectionString;

  pool = new Pool({ connectionString });
  db = drizzle(pool, { schema });

  // Run migrations from the drizzle folder
  await migrate(db, {
    migrationsFolder: resolve(__dirname, '../../drizzle'),
  });

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule.register({ persistence: 'drizzle' })],
  }).compile();

  app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  await app.init();

  return { app, db };
}

export async function createTestVault(
  testDb: NodePgDatabase<typeof schema>,
): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  await testDb.insert(schema.vault).values({
    id,
    token,
    createdAt: new Date(),
    budgetStartDay: 1,
  });
  return { id, token };
}

export async function truncateAll(
  testDb: NodePgDatabase<typeof schema>,
): Promise<void> {
  await testDb.execute(sql`
    TRUNCATE plan, budget, transaction, box, vault_category, chat, vault, action CASCADE
  `);
}

export async function stopTestApp(): Promise<void> {
  await app?.close();
  await pool?.end();
  await container?.stop();
}
