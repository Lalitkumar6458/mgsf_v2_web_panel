// Gupshup callback URL (paste in Gupshup → App → Webhooks / Callback URL). One per trust:
//   /api/whatsapp/callback/<trust id>/<secret>
// Receives delivery status (sent / delivered / read / failed) and members' messages (inbox).
// Always answers 200 quickly — Gupshup retries / disables callbacks that fail.
import { NextResponse } from "next/server";
import { handleCallback } from "@/services/whatsapp.js";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(request, ctx) {
  const { adminId, secret } = await ctx.params;
  let body = null;
  try { body = await request.json(); } catch { /* Gupshup's URL check sends an empty body */ }
  try {
    if (body) await handleCallback(adminId, secret, body);
  } catch (e) {
    console.error("[whatsapp callback]", e?.message || e);
  }
  return NextResponse.json({ ok: true });
}
