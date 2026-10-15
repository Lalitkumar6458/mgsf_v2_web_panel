CREATE TABLE "join_fee_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"member_id" text NOT NULL,
	"amount" integer NOT NULL,
	"payment_mode" text DEFAULT 'cash' NOT NULL,
	"transaction_ref" text DEFAULT '' NOT NULL,
	"payment_date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"agent_id" text,
	"created_by_id" text DEFAULT '' NOT NULL,
	"created_by_name" text DEFAULT '' NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "join_fee_payments" ADD CONSTRAINT "join_fee_payments_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_fee_payments" ADD CONSTRAINT "join_fee_payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "join_fee_member_idx" ON "join_fee_payments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "join_fee_program_idx" ON "join_fee_payments" USING btree ("program_id","payment_date");