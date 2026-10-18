-- Fixed rakam (seema): a member pays at most this much in all for closings. NULL = no limit.
-- dues.base_amount = the full amount of a due that was cut down by the limit (so it can grow back
-- when the limit is raised / removed or a closing is reverted). NULL = due is not cut.
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "fixed_limit" integer;--> statement-breakpoint
ALTER TABLE "dues" ADD COLUMN IF NOT EXISTS "base_amount" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_fixed_limit_idx" ON "members" USING btree ("program_id") WHERE "fixed_limit" IS NOT NULL;
