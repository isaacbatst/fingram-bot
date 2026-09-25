CREATE TABLE IF NOT EXISTS "card" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"name" text NOT NULL,
	"closing_day" integer NOT NULL,
	"due_day" integer NOT NULL,
	"box_id" text NOT NULL,
	"account_key" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_cycle" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"card_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"closing_date" timestamp NOT NULL,
	"due_date" timestamp NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"box_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"date" timestamp NOT NULL,
	"imported" boolean DEFAULT false NOT NULL,
	"import_entry_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "no_invoice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN IF NOT EXISTS "invoice_role" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN IF NOT EXISTS "source_transaction_id" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN IF NOT EXISTS "payment_id" text;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_cycle" ADD CONSTRAINT "card_cycle_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_cycle" ADD CONSTRAINT "card_cycle_card_id_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_payment" ADD CONSTRAINT "card_payment_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_payment" ADD CONSTRAINT "card_payment_invoice_id_card_cycle_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."card_cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_payment" ADD CONSTRAINT "card_payment_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_payment" ADD CONSTRAINT "card_payment_import_entry_id_import_entry_id_fk" FOREIGN KEY ("import_entry_id") REFERENCES "public"."import_entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_vault_account_key_unique" ON "card" USING btree ("vault_id","account_key") WHERE "card"."account_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_payment_id_card_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."card_payment"("id") ON DELETE cascade ON UPDATE no action;