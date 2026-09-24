CREATE TABLE IF NOT EXISTS "card_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"box_id" text,
	"amount" double precision NOT NULL,
	"payment_date" timestamp NOT NULL,
	"card_label" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "invoice_id" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN IF NOT EXISTS "invoice_id" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN IF NOT EXISTS "purchase_date" timestamp;--> statement-breakpoint
ALTER TABLE "card_invoice" ADD CONSTRAINT "card_invoice_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_invoice" ADD CONSTRAINT "card_invoice_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_invoice_id_card_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."card_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_invoice_id_card_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."card_invoice"("id") ON DELETE set null ON UPDATE no action;