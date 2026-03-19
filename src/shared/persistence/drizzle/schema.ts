import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  serial,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  integer,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Base categories - used as templates for vault categories
export const category = pgTable('category', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  description: text('description').default(''),
  transactionType: text('transaction_type').notNull(), // 'income' | 'expense' | 'both'
});

export const vault = pgTable('vault', {
  id: text('id').primaryKey(),
  token: text('token').notNull(),
  customPrompt: text('custom_prompt').default(''),
  createdAt: timestamp('created_at').notNull(),
  budgetStartDay: integer('budget_start_day').default(1).notNull(),
});

// Vault-specific categories - copies of base categories that can be edited per vault
export const vaultCategory = pgTable('vault_category', {
  id: text('id').primaryKey(),
  vaultId: text('vault_id')
    .notNull()
    .references(() => vault.id),
  baseCategoryId: text('base_category_id').references(() => category.id), // Reference to original, null if custom
  name: text('name').notNull(),
  code: text('code').notNull(),
  description: text('description').default(''),
  transactionType: text('transaction_type').notNull(), // 'income' | 'expense' | 'both'
});

export const box = pgTable('box', {
  id: text('id').primaryKey(),
  vaultId: text('vault_id')
    .notNull()
    .references(() => vault.id),
  name: text('name').notNull(),
  goalAmount: doublePrecision('goal_amount'),
  isDefault: boolean('is_default').notNull().default(false),
  type: text('type').notNull().default('spending'),
  createdAt: timestamp('created_at').notNull(),
});

export const chat = pgTable('chat', {
  id: text('id').primaryKey(),
  telegramChatId: text('telegram_chat_id').notNull(),
  vaultId: text('vault_id').references(() => vault.id),
});

export const transaction = pgTable('transaction', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  amount: doublePrecision('amount').notNull(),
  type: text('type').notNull(), // 'income' | 'expense'
  categoryId: text('category_id').references(() => vaultCategory.id), // Now references vaultCategory
  vaultId: text('vault_id')
    .notNull()
    .references(() => vault.id),
  description: text('description').default(''),
  createdAt: timestamp('created_at').notNull(),
  committed: boolean('committed').notNull().default(false),
  date: timestamp('date'),
  boxId: text('box_id').references(() => box.id),
  transferId: text('transfer_id'),
  allocationId: text('allocation_id').references(() => allocation.id, {
    onDelete: 'set null',
  }),
  withdrawalType: text('withdrawal_type'),
});

export const budget = pgTable('budget', {
  id: serial('id').primaryKey(),
  vaultId: text('vault_id')
    .notNull()
    .references(() => vault.id),
  categoryId: text('category_id')
    .notNull()
    .references(() => vaultCategory.id), // Now references vaultCategory
  amount: doublePrecision('amount').notNull(),
});

export const action = pgTable('action', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'expense' | 'income'
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at').notNull(),
  status: text('status').notNull(), // 'pending' | 'executed' | 'failed' | 'cancelled'
});

export const plan = pgTable('plan', {
  id: text('id').primaryKey(),
  vaultId: text('vault_id')
    .notNull()
    .references(() => vault.id),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  startDate: timestamp('start_date').notNull(),
  premises: jsonb('premises').notNull(),
  milestones: jsonb('milestones').notNull().default('[]'),
  createdAt: timestamp('created_at').notNull(),
});

export const allocation = pgTable(
  'allocation',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => plan.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    target: doublePrecision('target').notNull().default(0),
    monthlyAmount: jsonb('monthly_amount').notNull().default('[]'),
    realizationMode: text('realization_mode').notNull().default('manual'),
    yieldRate: doublePrecision('yield_rate'),
    financing: jsonb('financing'),
    scheduledMovements: jsonb('scheduled_movements').notNull().default('[]'),
    initialBalance: doublePrecision('initial_balance'),
    estratoId: text('estrato_id').references(() => box.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('allocation_estrato_id_unique')
      .on(table.estratoId)
      .where(sql`${table.estratoId} IS NOT NULL`),
  ],
);
