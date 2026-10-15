CREATE TYPE "public"."due_status" AS ENUM('pending', 'partial', 'paid');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('pending', 'accepted', 'rejected', 'removed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'agent', 'member');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"role" "role" NOT NULL,
	"login_id" text NOT NULL,
	"email" text,
	"phone" text,
	"password_hash" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"admin_id" text,
	"agent_id" text,
	"member_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"push_token" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_login_id_unique" UNIQUE("login_id"),
	CONSTRAINT "accounts_agent_id_unique" UNIQUE("agent_id"),
	CONSTRAINT "accounts_member_id_unique" UNIQUE("member_id")
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"trust_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"display_name" text NOT NULL,
	"agent_code" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"pin_code" text DEFAULT '' NOT NULL,
	"photo_url" text DEFAULT '' NOT NULL,
	"signature_url" text DEFAULT '' NOT NULL,
	"document_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"date_join" date,
	"status" text DEFAULT 'active' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "closing_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dues" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"closing_member_id" text NOT NULL,
	"payer_member_id" text NOT NULL,
	"amount" integer NOT NULL,
	"paid_amount" integer DEFAULT 0 NOT NULL,
	"status" "due_status" DEFAULT 'pending' NOT NULL,
	"due_date" date,
	"added_manually" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_method" text DEFAULT '' NOT NULL,
	"online_reference" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"agent_id" text,
	"registration_number" text DEFAULT '' NOT NULL,
	"application_number" text DEFAULT '' NOT NULL,
	"member_number" integer DEFAULT 0 NOT NULL,
	"status" "member_status" DEFAULT 'pending' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"father_name" text DEFAULT '' NOT NULL,
	"gender" text DEFAULT '' NOT NULL,
	"gotra" text DEFAULT '' NOT NULL,
	"jati" text DEFAULT '' NOT NULL,
	"guardian" text DEFAULT '' NOT NULL,
	"guardian_relation" text DEFAULT '' NOT NULL,
	"guardian_aadhar_no" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"phone_alt" text DEFAULT '' NOT NULL,
	"aadhaar_no" text DEFAULT '' NOT NULL,
	"birth_date" date,
	"current_address" text DEFAULT '' NOT NULL,
	"village" text DEFAULT '' NOT NULL,
	"district" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"pin_code" text DEFAULT '' NOT NULL,
	"age_group" text DEFAULT '' NOT NULL,
	"age_group_range" text DEFAULT '' NOT NULL,
	"member_group" text DEFAULT '' NOT NULL,
	"location_group" text DEFAULT '' NOT NULL,
	"location_group_id" text DEFAULT '' NOT NULL,
	"closing_months" integer DEFAULT 0 NOT NULL,
	"membership_closing_date" date,
	"date_join" date NOT NULL,
	"pay_amount" integer DEFAULT 200 NOT NULL,
	"join_fees" integer DEFAULT 0 NOT NULL,
	"join_fees_done" boolean DEFAULT false NOT NULL,
	"join_fees_txn_id" text DEFAULT '' NOT NULL,
	"join_fees_payment_type" text DEFAULT '' NOT NULL,
	"join_fees_paid_amount" integer DEFAULT 0 NOT NULL,
	"join_fees_remaining_amount" integer DEFAULT 0 NOT NULL,
	"added_by" text DEFAULT 'admin' NOT NULL,
	"added_by_name" text DEFAULT 'Admin' NOT NULL,
	"photo_url" text DEFAULT '' NOT NULL,
	"extra_image_url" text DEFAULT '' NOT NULL,
	"document_front_url" text DEFAULT '' NOT NULL,
	"document_back_url" text DEFAULT '' NOT NULL,
	"guardian_document_url" text DEFAULT '' NOT NULL,
	"guardian_document_back_url" text DEFAULT '' NOT NULL,
	"extra_details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"closing_date" date,
	"closing_at" timestamp with time zone,
	"closing_group_id" text,
	"closing_notes" text DEFAULT '' NOT NULL,
	"invitation_card_url" text DEFAULT '' NOT NULL,
	"pdf_data" jsonb,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"account_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otps" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"purpose" text DEFAULT 'login' NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"name" text NOT NULL,
	"hiname" text DEFAULT '' NOT NULL,
	"guname" text DEFAULT '' NOT NULL,
	"note_line" text DEFAULT '' NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"is_selected" boolean DEFAULT false NOT NULL,
	"age_groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location_groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reg_prefix" text DEFAULT 'R' NOT NULL,
	"reg_mode" text DEFAULT 'random' NOT NULL,
	"reg_digits" integer DEFAULT 6 NOT NULL,
	"reg_start_no" integer DEFAULT 1 NOT NULL,
	"reg_counter" integer DEFAULT 0 NOT NULL,
	"member_counter" integer DEFAULT 0 NOT NULL,
	"default_pay_amount" integer DEFAULT 200 NOT NULL,
	"sync_past_closings_on_accept" boolean DEFAULT false NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"transaction_number" text NOT NULL,
	"batch_id" text NOT NULL,
	"sequence_number" integer DEFAULT 1 NOT NULL,
	"payer_member_id" text NOT NULL,
	"closing_member_id" text,
	"due_id" text,
	"amount" integer NOT NULL,
	"is_full_payment" boolean DEFAULT true NOT NULL,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"payment_date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"online_reference" text DEFAULT '' NOT NULL,
	"online_verified" boolean DEFAULT false NOT NULL,
	"transaction_type" text DEFAULT 'marriage_payment' NOT NULL,
	"bulk_payment_mode" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_by_id" text DEFAULT '' NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_transaction_number_unique" UNIQUE("transaction_number")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_groups" ADD CONSTRAINT "closing_groups_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues" ADD CONSTRAINT "dues_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues" ADD CONSTRAINT "dues_closing_member_id_members_id_fk" FOREIGN KEY ("closing_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues" ADD CONSTRAINT "dues_payer_member_id_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_closing_group_id_closing_groups_id_fk" FOREIGN KEY ("closing_group_id") REFERENCES "public"."closing_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payer_member_id_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_closing_member_id_members_id_fk" FOREIGN KEY ("closing_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_due_id_dues_id_fk" FOREIGN KEY ("due_id") REFERENCES "public"."dues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_admin_idx" ON "accounts" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "agents_admin_idx" ON "agents" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "closing_groups_program_idx" ON "closing_groups" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dues_closing_payer_uq" ON "dues" USING btree ("closing_member_id","payer_member_id");--> statement-breakpoint
CREATE INDEX "dues_program_status_idx" ON "dues" USING btree ("program_id","status");--> statement-breakpoint
CREATE INDEX "dues_payer_status_idx" ON "dues" USING btree ("payer_member_id","status");--> statement-breakpoint
CREATE INDEX "members_program_status_idx" ON "members" USING btree ("program_id","status");--> statement-breakpoint
CREATE INDEX "members_program_agent_idx" ON "members" USING btree ("program_id","agent_id");--> statement-breakpoint
CREATE INDEX "members_program_closing_idx" ON "members" USING btree ("program_id","closing_date");--> statement-breakpoint
CREATE INDEX "members_program_appno_idx" ON "members" USING btree ("program_id","application_number");--> statement-breakpoint
CREATE INDEX "members_program_aadhaar_idx" ON "members" USING btree ("program_id","aadhaar_no");--> statement-breakpoint
CREATE INDEX "members_regno_idx" ON "members" USING btree ("registration_number");--> statement-breakpoint
CREATE INDEX "notifications_admin_idx" ON "notifications" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_account_idx" ON "notifications" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "otps_email_idx" ON "otps" USING btree ("email","purpose");--> statement-breakpoint
CREATE INDEX "programs_admin_idx" ON "programs" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "tx_program_created_idx" ON "transactions" USING btree ("program_id","created_at");--> statement-breakpoint
CREATE INDEX "tx_program_ref_idx" ON "transactions" USING btree ("program_id","online_reference");--> statement-breakpoint
CREATE INDEX "tx_payer_idx" ON "transactions" USING btree ("payer_member_id");--> statement-breakpoint
CREATE INDEX "tx_batch_idx" ON "transactions" USING btree ("batch_id");