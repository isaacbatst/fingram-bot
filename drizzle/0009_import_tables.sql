-- Import de extrato (OFX) — ISA-115.
-- Ver docs/product/spec-operational.md §9.
--
-- Escrita à mão porque a cadeia de snapshots está incompleta (faltam 0004, 0007 e
-- 0008), então `drizzle-kit generate` diffa contra o snapshot 0006 e reemitiria
-- alterações já aplicadas em produção. Chaves estrangeiras declaradas inline e
-- CREATE ... IF NOT EXISTS para que a migration seja idempotente.

CREATE TABLE IF NOT EXISTS "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL REFERENCES "public"."vault"("id"),
	"account_key" text NOT NULL,
	"account_label" text,
	"box_id" text REFERENCES "public"."box"("id"),
	"kind" text DEFAULT 'bank' NOT NULL,
	"currency" text,
	"period_start" timestamp,
	"period_end" timestamp,
	"ledger_balance" double precision,
	"file_name" text,
	"status" text DEFAULT 'reviewing' NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL REFERENCES "public"."import_batch"("id") ON DELETE cascade,
	"vault_id" text NOT NULL REFERENCES "public"."vault"("id"),
	"account_key" text NOT NULL,
	"fit_id" text NOT NULL,
	"raw_date" timestamp NOT NULL,
	"raw_amount" double precision NOT NULL,
	"raw_type" text NOT NULL,
	"raw_memo" text,
	"raw_name" text,
	"date" timestamp NOT NULL,
	"amount" double precision NOT NULL,
	"type" text NOT NULL,
	"description" text DEFAULT '',
	"category_id" text REFERENCES "public"."vault_category"("id"),
	"box_id" text REFERENCES "public"."box"("id"),
	"suggested_category_id" text REFERENCES "public"."vault_category"("id"),
	"suggestion_source" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"transaction_id" text REFERENCES "public"."transaction"("id") ON DELETE set null,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
-- FITID é único por conta, não globalmente: dois bancos podem emitir o mesmo valor.
-- Sem account_key na chave, um lançamento legítimo da segunda conta seria descartado
-- como duplicado, e em silêncio.
CREATE UNIQUE INDEX IF NOT EXISTS "import_entry_dedup_unique" ON "import_entry" ("vault_id","account_key","fit_id");
