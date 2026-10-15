CREATE TABLE IF NOT EXISTS "certificate_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"program_id" text,
	"page" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"art" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frame_img" text DEFAULT '' NOT NULL,
	"elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_templates_admin_idx" ON "certificate_templates" USING btree ("admin_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "certificate_templates_default_uq" ON "certificate_templates" USING btree ("admin_id") WHERE "is_default";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "certificate_templates_program_uq" ON "certificate_templates" USING btree ("program_id") WHERE "program_id" IS NOT NULL;
