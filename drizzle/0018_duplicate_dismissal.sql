CREATE TABLE IF NOT EXISTS "duplicate_dismissal" (
	"vault_id" text NOT NULL,
	"manual_transaction_id" text NOT NULL,
	"imported_transaction_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "duplicate_dismissal" ADD CONSTRAINT "duplicate_dismissal_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_dismissal" ADD CONSTRAINT "duplicate_dismissal_manual_transaction_id_transaction_id_fk" FOREIGN KEY ("manual_transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_dismissal" ADD CONSTRAINT "duplicate_dismissal_imported_transaction_id_transaction_id_fk" FOREIGN KEY ("imported_transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "duplicate_dismissal_pair_unique" ON "duplicate_dismissal" USING btree ("manual_transaction_id","imported_transaction_id");