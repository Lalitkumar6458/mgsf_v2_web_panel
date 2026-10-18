import { NextResponse } from "next/server";
import { route } from "@/lib/http.js";
import { closingPdf } from "@/services/mobilePdf.js";

const pdf = (buf, name) => new NextResponse(buf, {
  headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"`, "Cache-Control": "no-store" },
});

export const runtime = "nodejs";
/** Agent: one closing's payers. ?mode=pending|paid|all */
export const GET = route(async ({ auth, params, query }) => {
  const mode = query.get("mode") || "pending";
  return pdf(await closingPdf(auth, params.id, mode), `closing-${mode}`);
});
