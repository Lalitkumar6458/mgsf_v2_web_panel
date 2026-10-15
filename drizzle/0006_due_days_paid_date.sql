ALTER TABLE "programs" ADD COLUMN IF NOT EXISTS "due_days" integer DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "dues" ADD COLUMN IF NOT EXISTS "paid_date" date;--> statement-breakpoint
-- date the due became fully paid = latest completed payment for it
UPDATE "dues" d SET "paid_date" = t.mx
FROM (SELECT "due_id", max("payment_date") AS mx FROM "transactions" WHERE "status" = 'completed' AND "due_id" IS NOT NULL GROUP BY "due_id") t
WHERE t."due_id" = d."id" AND d."status" = 'paid';--> statement-breakpoint
UPDATE "dues" SET "paid_date" = ("paid_at" AT TIME ZONE 'Asia/Kolkata')::date WHERE "status" = 'paid' AND "paid_date" IS NULL AND "paid_at" IS NOT NULL;--> statement-breakpoint
-- due date = closing date + 45 days (the payer joined before the closing, so the closing date is the start)
UPDATE "dues" d SET "due_date" = c."closing_date" + 45
FROM "members" c WHERE c."id" = d."closing_member_id" AND c."closing_date" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dues_program_due_idx" ON "dues" USING btree ("program_id", "due_date");
--> statement-breakpoint
ANALYZE "dues";
