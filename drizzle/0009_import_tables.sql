-- Import de extrato (OFX) — ISA-115. Ver docs/product/spec-operational.md §9.
--
-- Gerado por `drizzle-kit generate` (o snapshot 0009 e a entrada no journal vieram
-- da mesma execução). Foram REMOVIDOS quatro statements que o gerador reemitiu por
-- causa da lacuna de snapshots 0004/0007/0008 — todos já aplicados em produção
-- pelas migrations 0007 e 0008, e que quebrariam o deploy se rodassem de novo:
--
--   ALTER TABLE "allocation" ADD COLUMN "realization_mode" ...   (0007)
--   ALTER TABLE "transaction" ADD COLUMN "withdrawal_type" ...   (0007)
--   ALTER TABLE "allocation" DROP COLUMN "holds_funds";          (0007)
--   ALTER TABLE "vault" ADD COLUMN "budget_start_day_overrides" (0008)
--
-- Com o snapshot 0009 no lugar, as próximas migrations voltam a ser geradas
-- normalmente e não precisam desse cuidado.

CREATE TABLE IF NOT EXISTS "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"account_key" text NOT NULL,
	"account_label" text,
	"box_id" text,
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
	"batch_id" text NOT NULL,
	"vault_id" text NOT NULL,
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
	"category_id" text,
	"box_id" text,
	"suggested_category_id" text,
	"suggestion_source" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"transaction_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_entry" ADD CONSTRAINT "import_entry_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_entry" ADD CONSTRAINT "import_entry_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_entry" ADD CONSTRAINT "import_entry_category_id_vault_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vault_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_entry" ADD CONSTRAINT "import_entry_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_entry" ADD CONSTRAINT "import_entry_suggested_category_id_vault_category_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."vault_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_entry" ADD CONSTRAINT "import_entry_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_entry_dedup_unique" ON "import_entry" USING btree ("vault_id","account_key","fit_id");
