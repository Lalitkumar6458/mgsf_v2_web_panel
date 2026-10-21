// Mobile app, before login: trust name / logo / colours for the welcome + login screens.
import { NextResponse } from "next/server";
import { publicBranding, brandingAdmin, requestHost } from "@/services/trust.js";
import { appPalette } from "@/lib/theme/themes.js";
import { appLogo } from "@/services/mobileApp.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const host = requestHost(request);
    const a = await brandingAdmin(host);
    const r = a ? { theme: a.extra?.theme, trust_info: a.trustInfo } : null;
    const b = await publicBranding(host);
    return NextResponse.json({
      branding: { ...b, logo: appLogo(r?.trust_info?.logo), contact: r?.trust_info?.contact || "", topTitle: Array.isArray(r?.trust_info?.topTitle) ? r.trust_info.topTitle : [] },
      palette: appPalette(r?.theme),
      minVersion: process.env.APP_MIN_VERSION || "",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ branding: {}, palette: appPalette(null) });
  }
}
