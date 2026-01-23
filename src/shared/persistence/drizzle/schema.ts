import {
  pgTable,
  text,
  serial,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
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
