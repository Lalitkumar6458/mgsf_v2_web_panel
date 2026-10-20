-- Data migration (Firebase → this panel) and Excel / CSV imports: one row per run, with live progress.
--   steps   [{ key, label, status: wait|run|done|fail|skip, done, total, note }]
--   report  counts, money, warnings, verify checks, file failures
--   logins_enc  generated passwords (AES-GCM with JWT_SECRET) — download once, then "delete passwords"
CREATE TABLE IF NOT EXISTS "migration_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "source_project" text DEFAULT '' NOT NULL,
  "source_trust_id" text DEFAULT '' NOT NULL,
  "source_trust_name" text DEFAULT '' NOT NULL,
  "target_admin_id" text,
  "mode" text DEFAULT 'new' NOT NULL,
  "dry_run" boolean DEFAULT false NOT NULL,
  "options" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "log" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "report" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text DEFAULT '' NOT NULL,
  "logins_enc" text,
  "created_by" text DEFAULT '' NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_jobs_started_idx" ON "migration_jobs" USING btree ("started_at");
