// Mobile app, before login: trust name / logo / colours for the welcome + login screens.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { publicBranding } from "@/services/trust.js";
import { appPalette } from "@/lib/theme/themes.js";
import { appLogo } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows: [r] } = await db.execute(sql`SELECT extra->'theme' AS theme, trust_info FROM admins ORDER BY created_at LIMIT 1`);
    const b = await publicBranding();
    return NextResponse.json({
      branding: { ...b, logo: appLogo(r?.trust_info?.logo), contact: r?.trust_info?.contact || "", topTitle: Array.isArray(r?.trust_info?.topTitle) ? r.trust_info.topTitle : [] },
      palette: appPalette(r?.theme),
      minVersion: process.env.APP_MIN_VERSION || "",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ branding: {}, palette: appPalette(null) });
  }
}
