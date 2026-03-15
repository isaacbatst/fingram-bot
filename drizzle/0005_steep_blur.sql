CREATE TABLE "allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"label" text NOT NULL,
	"target" double precision DEFAULT 0 NOT NULL,
	"monthly_amount" jsonb DEFAULT '[]' NOT NULL,
	"holds_funds" boolean NOT NULL,
	"yield_rate" double precision,
	"financing" jsonb,
	"scheduled_movements" jsonb DEFAULT '[]' NOT NULL,
	"initial_balance" double precision,
	"estrato_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "allocation_id" text;--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_estrato_id_box_id_fk" FOREIGN KEY ("estrato_id") REFERENCES "public"."box"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_allocation_id_allocation_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "fund_allocation";--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "phases";--> statement-breakpoint
-- Extract existing boxes JSONB into allocation table
INSERT INTO "allocation" ("id", "plan_id", "label", "target", "monthly_amount", "holds_funds", "yield_rate", "financing", "scheduled_movements", "initial_balance", "estrato_id", "created_at")
SELECT
  box_data->>'id',
  p."id",
  box_data->>'label',
  COALESCE((box_data->>'target')::double precision, 0),
  COALESCE(box_data->'monthlyAmount', '[]'::jsonb),
  COALESCE((box_data->>'holdsFunds')::boolean, true),
  (box_data->>'yieldRate')::double precision,
  box_data->'financing',
  COALESCE(box_data->'scheduledMovements', '[]'::jsonb),
  (box_data->>'initialBalance')::double precision,
  NULL,
  p."created_at"
FROM "plan" p,
     jsonb_array_elements(p."boxes") AS box_data
WHERE jsonb_array_length(p."boxes") > 0;--> statement-breakpoint
ALTER TABLE "plan" DROP COLUMN "boxes";
