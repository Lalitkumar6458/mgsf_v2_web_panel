-- Logged-in phones: which phone (model, Android version, app version) and its own push token,
-- so the panel can show "kitne phone par login" and log one phone out (push stops for it too).
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "device" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "platform" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "app_version" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "push_token" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_push_token_idx" ON "sessions" USING btree ("push_token") WHERE "push_token" IS NOT NULL;
