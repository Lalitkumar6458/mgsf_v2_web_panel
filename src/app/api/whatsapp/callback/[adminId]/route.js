// Gupshup callback URL (Gupshup → App → Webhooks): /api/whatsapp/callback/<trust id>
// No key needed in the URL. A key header is optional — x-webhook-key: <key> (x-api-key / Authorization: Bearer);
// if one is sent it must be right. Trust id must exist with WhatsApp set up.
// Receives delivery status (sent / delivered / read / failed) and members' messages (inbox).
// Always answers 200 quickly — Gupshup retries / disables callbacks that fail.
import { NextResponse } from "next/server";
import { handleCallback, keyFromHeaders } from "@/services/whatsapp.js";

export const dynamic = "force-dynamic";

// Gupshup checks the URL with a GET / empty POST when you save it
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(request, ctx) {
  const { adminId } = await ctx.params;
  let body = null;
  try { body = await request.json(); } catch { /* URL check: empty body */ }
  try {
    if (body) {
      const r = await handleCallback(adminId, keyFromHeaders(request.headers), body, { keyOptional: true });
      if (r?.reason === "secret") console.warn("[whatsapp callback] wrong / missing key header for", adminId);
    }
  } catch (e) {
    console.error("[whatsapp callback]", e?.message || e);
  }
  return NextResponse.json({ ok: true });
}
