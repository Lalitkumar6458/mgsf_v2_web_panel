ALTER TABLE "certificate_templates" ADD COLUMN IF NOT EXISTS "bg" jsonb DEFAULT '{}'::jsonb NOT NULL;
