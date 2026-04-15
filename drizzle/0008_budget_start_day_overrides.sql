ALTER TABLE "vault" ADD COLUMN IF NOT EXISTS "budget_start_day_overrides" jsonb NOT NULL DEFAULT '[]'::jsonb;
