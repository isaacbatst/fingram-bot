ALTER TABLE "vault" ADD COLUMN "budget_start_day_overrides" jsonb NOT NULL DEFAULT '[]'::jsonb;
