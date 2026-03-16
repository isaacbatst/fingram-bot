-- Add realization_mode column with a default
ALTER TABLE "allocation" ADD COLUMN "realization_mode" text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
-- Migrate existing data: holds_funds=true -> 'manual', holds_funds=false -> 'immediate'
UPDATE "allocation" SET "realization_mode" = CASE
  WHEN "holds_funds" = true THEN 'manual'
  ELSE 'immediate'
END;
--> statement-breakpoint
-- Drop the old column
ALTER TABLE "allocation" DROP COLUMN "holds_funds";
--> statement-breakpoint
-- Add withdrawal_type column to transaction (for realization tracking)
ALTER TABLE "transaction" ADD COLUMN "withdrawal_type" text;
