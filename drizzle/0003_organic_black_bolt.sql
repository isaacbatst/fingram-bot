ALTER TABLE "plan" ADD COLUMN "phases" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "milestones" jsonb DEFAULT '[]' NOT NULL;