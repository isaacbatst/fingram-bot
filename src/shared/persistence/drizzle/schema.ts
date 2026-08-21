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
  budgetStartDayOverrides: jsonb('budget_start_day_overrides')
    .notNull()
    .default(sql`'[]'::jsonb`),
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

// One imported statement file. Holds the account identity so every entry can be
// deduplicated per account, and the estrato the account is bound to.
export const importBatch = pgTable('import_batch', {
  id: text('id').primaryKey(),
  vaultId: text('vault_id')
    .notNull()
    .references(() => vault.id),
  accountKey: text('account_key').notNull(), // BANKID:ACCTID:ACCTTYPE
  accountLabel: text('account_label'),
  boxId: text('box_id').references(() => box.id),
  kind: text('kind').notNull().default('bank'), // 'bank' | 'creditcard'
  currency: text('currency'),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  ledgerBalance: doublePrecision('ledger_balance'),
  fileName: text('file_name'),
  status: text('status').notNull().default('reviewing'), // 'reviewing' | 'done'
  // Lines skipped at ingestion for already-seen FITIDs. Persisted so the review
  // summary still reports them after a reload — it is where dedup becomes visible.
  duplicateCount: integer('duplicate_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull(),
});

// One line from an imported file. The `raw*` columns keep the file's own values and
// are never overwritten — they are the key for deduplication and, from ISA-116 on,
// for matching against previously confirmed descriptions. The remaining columns are
// the editable working values that become a transaction on confirmation.
export const importEntry = pgTable(
  'import_entry',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => importBatch.id, { onDelete: 'cascade' }),
    vaultId: text('vault_id')
      .notNull()
      .references(() => vault.id),
    accountKey: text('account_key').notNull(),
    fitId: text('fit_id').notNull(),
    rawDate: timestamp('raw_date').notNull(),
    rawAmount: doublePrecision('raw_amount').notNull(), // signed, as in the file
    rawType: text('raw_type').notNull(), // 'income' | 'expense'
    rawMemo: text('raw_memo'),
    rawName: text('raw_name'),
    date: timestamp('date').notNull(),
    amount: doublePrecision('amount').notNull(), // always positive
    type: text('type').notNull(), // 'income' | 'expense'
    description: text('description').default(''),
    categoryId: text('category_id').references(() => vaultCategory.id),
    boxId: text('box_id').references(() => box.id),
    suggestedCategoryId: text('suggested_category_id').references(
      () => vaultCategory.id,
    ),
    suggestionSource: text('suggestion_source').notNull().default('none'), // 'history' | 'ai' | 'none'
    status: text('status').notNull().default('pending'), // 'pending' | 'confirmed' | 'dismissed'
    transactionId: text('transaction_id').references(() => transaction.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    // FITID is unique per account, not globally: two banks can emit the same value.
    // Leaving accountKey out would silently discard a legitimate line from a second
    // account as if it were a duplicate.
    uniqueIndex('import_entry_dedup_unique').on(
      table.vaultId,
      table.accountKey,
      table.fitId,
    ),
  ],
);
