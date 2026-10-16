-- Audit log (who changed what), agent cash handover, receipt register (rasid book + verify codes)
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"account_id" text DEFAULT '' NOT NULL,
	"actor_name" text DEFAULT '' NOT NULL,
	"actor_role" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"entity" text DEFAULT '' NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_admin_time_idx" ON "audit_logs" USING btree ("admin_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" USING btree ("admin_id", "entity", "entity_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_handovers" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"program_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"amount" integer NOT NULL,
	"handed_on" date NOT NULL,
	"mode" text DEFAULT 'cash' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"received_by" text DEFAULT '' NOT NULL,
	"received_by_name" text DEFAULT '' NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_handovers_agent_idx" ON "cash_handovers" USING btree ("program_id", "agent_id", "handed_on");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt_register" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"program_id" text NOT NULL,
	"member_id" text NOT NULL,
	"receipt_no" text DEFAULT '' NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"entries" integer DEFAULT 0 NOT NULL,
	"due_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipt_register" ADD CONSTRAINT "receipt_register_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_register" ADD CONSTRAINT "receipt_register_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_register_member_idx" ON "receipt_register" USING btree ("program_id", "member_id");
