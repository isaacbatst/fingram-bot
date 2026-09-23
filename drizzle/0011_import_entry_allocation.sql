ALTER TABLE "import_entry" ADD COLUMN IF NOT EXISTS "allocation_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "import_entry" ADD CONSTRAINT "import_entry_allocation_id_allocation_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocation"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
