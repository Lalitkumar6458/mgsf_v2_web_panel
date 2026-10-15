ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "commission" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_commission_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"payout_number" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_mode" text DEFAULT 'cash' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"payout_date" date NOT NULL,
	"commission_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"created_by_id" text DEFAULT '' NOT NULL,
	"created_by_name" text DEFAULT '' NOT NULL,
	"reverted_at" timestamp with time zone,
	"revert_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_commissions" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"program_id" text,
	"member_id" text,
	"closing_member_id" text,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"kind" text DEFAULT 'earned' NOT NULL,
	"base_amount" integer NOT NULL,
	"rate_type" text NOT NULL,
	"rate_value" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payout_id" text,
	"payment_date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_commission_payouts" ADD CONSTRAINT "agent_commission_payouts_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commission_payouts" ADD CONSTRAINT "agent_commission_payouts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commissions" ADD CONSTRAINT "agent_commissions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commissions" ADD CONSTRAINT "agent_commissions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commissions" ADD CONSTRAINT "agent_commissions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commissions" ADD CONSTRAINT "agent_commissions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commissions" ADD CONSTRAINT "agent_commissions_closing_member_id_members_id_fk" FOREIGN KEY ("closing_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commissions" ADD CONSTRAINT "agent_commissions_payout_id_agent_commission_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."agent_commission_payouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_source_uq" ON "agent_commissions" USING btree ("source","source_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_agent_idx" ON "agent_commissions" USING btree ("agent_id","payment_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_agent_status_idx" ON "agent_commissions" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_payout_idx" ON "agent_commissions" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_member_idx" ON "agent_commissions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_payout_agent_idx" ON "agent_commission_payouts" USING btree ("agent_id","payout_date");
