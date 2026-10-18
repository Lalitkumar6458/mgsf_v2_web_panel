// Public PDF for a WhatsApp message (Gupshup downloads it): certificate / pending rasid / paid rasid.
// The link is signed and expires (services/whatsapp.js → fileToken) — no login needed, nothing else reachable.
import { NextResponse } from "next/server";
import { route } from "@/lib/http.js";
import { notFound, forbidden } from "@/lib/errors.js";
import { publicOrigin } from "@/lib/access.js";
import { readFileToken } from "@/services/whatsapp.js";
import { memberRow } from "@/services/mobileApp.js";
import { receiptPdf } from "@/services/mobilePdf.js";
import { certificatePdf } from "@/services/certificatePdf.js";
import { getTrustFeatures } from "@/services/features.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async ({ params, request }) => {
  const t = readFileToken(params.token);
  if (!t) throw forbidden("Link purana ya galat hai");
  const m = await memberRow(t.memberId);
  if (!m || m.admin_id !== t.adminId) throw notFound("Nahi mila");
  const f = await getTrustFeatures(t.adminId);
  const auth = { adminId: t.adminId, features: f.flags, accountId: "whatsapp", role: "admin" };
  const origin = publicOrigin(request);
  const buf = t.kind === "certificate"
    ? await certificatePdf({ adminId: t.adminId, m, features: f.flags, origin })
    : await receiptPdf(auth, m, { batchId: t.batchId, status: t.kind === "pendingReceipt" ? "pending" : "paid", origin });
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${String(params.name || "file.pdf").replace(/[^\w.-]/g, "")}"`,
      "Cache-Control": "private, max-age=600",
    },
  });
}, { auth: false });
