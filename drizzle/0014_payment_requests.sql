-- App payment requests: a member / agent paid the trust (UPI QR / bank) and asks the office to record it.
-- The office checks UTR + screenshot, then approves (payment is written like any other: dues paid,
-- transactions, receipt, push / WhatsApp) or rejects with a reason.
--   items  [{ memberId, programId, dueIds: [..], joinFee: ₹ }]   what the money is for
--   result { batches: [..], closingAmount, joinFeeAmount, advanceAmount }  what approving wrote
CREATE TABLE IF NOT EXISTS "payment_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "admin_id" text NOT NULL REFERENCES "admins"("id") ON DELETE CASCADE,
  "request_no" text NOT NULL,
  "requested_by_role" text NOT NULL,
  "requested_by_account_id" text NOT NULL DEFAULT '',
  "requested_by_name" text NOT NULL DEFAULT '',
  "agent_id" text,
  "amount" integer NOT NULL CHECK ("amount" > 0),
  "expected_amount" integer NOT NULL DEFAULT 0,
  "method" text NOT NULL DEFAULT 'upi',
  "reference" text NOT NULL DEFAULT '',
  "payment_date" date NOT NULL,
  "screenshot_url" text NOT NULL DEFAULT '',
  "note" text NOT NULL DEFAULT '',
  "items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "reviewed_by_id" text NOT NULL DEFAULT '',
  "reviewed_by_name" text NOT NULL DEFAULT '',
  "reviewed_at" timestamp with time zone,
  "reject_reason" text NOT NULL DEFAULT '',
  "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payreq_admin_status_idx" ON "payment_requests" USING btree ("admin_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payreq_account_idx" ON "payment_requests" USING btree ("requested_by_account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payreq_reference_idx" ON "payment_requests" USING btree ("admin_id","reference");
