import { NextResponse } from "next/server";
import { publicBranding } from "@/services/trust.js";

export const dynamic = "force-dynamic";

/** Name + logo for the login page (no login needed, no private data). */
export async function GET() {
  try {
    return NextResponse.json(await publicBranding(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({}, { status: 200 });
  }
}
