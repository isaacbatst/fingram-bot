ALTER TABLE "plan" ADD COLUMN "boxes" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "fund_allocation";--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "phases";