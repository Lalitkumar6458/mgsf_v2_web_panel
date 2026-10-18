import { NextResponse } from "next/server";
import { route } from "@/lib/http.js";
import { publicOrigin } from "@/lib/access.js";
import { forbidden } from "@/lib/errors.js";
import { memberFor } from "@/services/mobileApp.js";
import { receiptPdf } from "@/services/mobilePdf.js";

const pdf = (buf, name) => new NextResponse(buf, {
  headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"`, "Cache-Control": "no-store" },
});

export const runtime = "nodejs";
/** Rasid of one member (id). ?batch=<payment batch> for one payment, else ?status=pending|paid for all. */
export const GET = route(async ({ auth, params, query, request }) => {
  if (auth.features?.receipts === false) throw forbidden("रसीद अभी बंद है");
  const m = await memberFor(auth, params.id);
  const status = query.get("status") === "pending" ? "pending" : "paid";
  const buf = await receiptPdf(auth, m, { batchId: query.get("batch") || "", status, origin: publicOrigin(request) });
  return pdf(buf, `rasid-${m.registration_number || m.id}-${status}`);
});
