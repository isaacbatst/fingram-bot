ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "from_date" timestamp;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN IF NOT EXISTS "out_of_range_count" integer DEFAULT 0 NOT NULL;
