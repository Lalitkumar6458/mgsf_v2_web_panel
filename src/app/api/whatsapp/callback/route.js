// Gupshup callback URL — the same for every trust on this server: /api/whatsapp/callback
// The trust is found from the key header (x-webhook-key, optional) or Gupshup's "app" name in the
// payload (= app name in Settings → WhatsApp). Receives delivery status + members' messages (inbox).
// Always answers 200 quickly — Gupshup retries / disables callbacks that fail.
// (Older links /callback/<trustId> and /callback/<trustId>/<key> keep working.)
import { NextResponse } from "next/server";
import { handleCallback, keyFromHeaders, trustForCallback } from "@/services/whatsapp.js";

export const dynamic = "force-dynamic";

// Gupshup checks the URL with a GET / empty POST when you save it
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(request) {
  let body = null;
  try { body = await request.json(); } catch { /* URL check: empty body */ }
  try {
    if (body) {
      const key = keyFromHeaders(request.headers);
      const t = await trustForCallback(body, key);
      if (!t) console.warn("[whatsapp callback] trust not found — app:", body.app || "-", key ? "(wrong key)" : "");
      else await handleCallback(t.adminId, key, body, { keyOptional: true });
    }
  } catch (e) {
    console.error("[whatsapp callback]", e?.message || e);
  }
  return NextResponse.json({ ok: true });
}
