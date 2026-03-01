CREATE TABLE "action" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "box" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"name" text NOT NULL,
	"goal_amount" double precision,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"category_id" text NOT NULL,
	"amount" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '',
	"transaction_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"vault_id" text
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"amount" double precision NOT NULL,
	"type" text NOT NULL,
	"category_id" text,
	"vault_id" text NOT NULL,
	"description" text DEFAULT '',
	"created_at" timestamp NOT NULL,
	"committed" boolean DEFAULT false NOT NULL,
	"date" timestamp,
	"box_id" text,
	"transfer_id" text
);
--> statement-breakpoint
CREATE TABLE "vault" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"custom_prompt" text DEFAULT '',
	"created_at" timestamp NOT NULL,
	"budget_start_day" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_category" (
	"id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"base_category_id" text,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '',
	"transaction_type" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "box" ADD CONSTRAINT "box_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_category_id_vault_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vault_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_vault_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vault_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_category" ADD CONSTRAINT "vault_category_vault_id_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_category" ADD CONSTRAINT "vault_category_base_category_id_category_id_fk" FOREIGN KEY ("base_category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;