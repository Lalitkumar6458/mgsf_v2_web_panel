-- Advance (अग्रिम) money a member gives before his closings are due. Ledger, one row per movement:
--   deposit  money received in advance (cash / upi / …)          +
--   use      advance spent on closing payments (batch_id)         −
--   return   a payment made from advance was reversed (tx id)     +
--   refund   advance given back to the member                     −
-- balance = deposits + returns − uses − refunds (status 'completed' rows only)
CREATE TABLE IF NOT EXISTS "member_advances" (
  "id" text PRIMARY KEY NOT NULL,
  "program_id" text NOT NULL REFERENCES "programs"("id") ON DELETE CASCADE,
  "member_id" text NOT NULL REFERENCES "members"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "amount" integer NOT NULL CHECK ("amount" > 0),
  "method" text DEFAULT 'cash' NOT NULL,
  "payment_date" date NOT NULL,
  "reference" text DEFAULT '' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "batch_id" text,
  "transaction_id" text,
  "status" text DEFAULT 'completed' NOT NULL,
  "agent_id" text,
  "created_by_id" text DEFAULT '' NOT NULL,
  "created_by_name" text DEFAULT '' NOT NULL,
  "extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adv_member_idx" ON "member_advances" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adv_program_idx" ON "member_advances" USING btree ("program_id","payment_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adv_batch_idx" ON "member_advances" USING btree ("batch_id");
