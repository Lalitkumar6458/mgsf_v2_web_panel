-- WhatsApp (Gupshup) messages: everything the panel sent (join / pending / paid / reply / test)
-- and everything members wrote back (inbox). Status comes from Gupshup's callback URL.
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "admin_id" text NOT NULL REFERENCES "admins"("id") ON DELETE CASCADE,
  "direction" text DEFAULT 'out' NOT NULL,
  "phone" text NOT NULL,
  "member_id" text,
  "event" text DEFAULT '' NOT NULL,
  "template_id" text DEFAULT '' NOT NULL,
  "params" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "media_url" text DEFAULT '' NOT NULL,
  "media_type" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "provider_id" text,
  "gs_id" text,
  "error" text DEFAULT '' NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_admin_idx" ON "whatsapp_messages" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_phone_idx" ON "whatsapp_messages" USING btree ("admin_id","phone","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_provider_idx" ON "whatsapp_messages" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_member_event_idx" ON "whatsapp_messages" USING btree ("member_id","event");
