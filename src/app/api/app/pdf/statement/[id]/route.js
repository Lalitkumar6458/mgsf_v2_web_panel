import { NextResponse } from "next/server";
import { route } from "@/lib/http.js";
import { memberFor } from "@/services/mobileApp.js";
import { statementPdf } from "@/services/mobilePdf.js";

const pdf = (buf, name) => new NextResponse(buf, {
  headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"`, "Cache-Control": "no-store" },
});

export const runtime = "nodejs";
/** Member account PDF. ?mode=all|pending|paid|late */
export const GET = route(async ({ auth, params, query }) => {
  const m = await memberFor(auth, params.id);
  const mode = query.get("mode") || "all";
  return pdf(await statementPdf(auth, m, mode), `statement-${m.registration_number || m.id}-${mode}`);
});
