import { NextResponse } from "next/server";
import { route } from "@/lib/http.js";
import { agentDuesPdf } from "@/services/mobilePdf.js";

const pdf = (buf, name) => new NextResponse(buf, {
  headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"`, "Cache-Control": "no-store" },
});

export const runtime = "nodejs";
/** Agent: his members list PDF. ?programId=&mode=pending|paid|fee */
export const GET = route(async ({ auth, query }) => {
  const mode = query.get("mode") || "pending";
  return pdf(await agentDuesPdf(auth, { programId: query.get("programId"), mode }), `agent-${mode}-list`);
});
