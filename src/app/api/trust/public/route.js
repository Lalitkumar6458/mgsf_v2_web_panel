import { NextResponse } from "next/server";
import { publicBranding, requestHost } from "@/services/trust.js";

export const dynamic = "force-dynamic";

/** Name + logo for the login page (no login needed, no private data). */
export async function GET(request) {
  try {
    return NextResponse.json(await publicBranding(requestHost(request)), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}
