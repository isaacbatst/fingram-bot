ALTER TABLE "import_batch" DROP CONSTRAINT IF EXISTS "import_batch_invoice_id_card_invoice_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction" DROP CONSTRAINT IF EXISTS "transaction_invoice_id_card_invoice_id_fk";
--> statement-breakpoint
DROP TABLE IF EXISTS "card_invoice" CASCADE;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_invoice_id_card_cycle_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."card_cycle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_invoice_id_card_cycle_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."card_cycle"("id") ON DELETE set null ON UPDATE no action;
