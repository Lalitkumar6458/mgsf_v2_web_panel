// Public: GET /api/verify/r/<code> — the paid receipt behind a verify QR (no login).
import { route } from "@/lib/http.js";
import { notFound } from "@/lib/errors.js";
import { verifyReceipt } from "@/services/verify.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ params }) => {
  const r = await verifyReceipt(params.code);
  if (!r) throw notFound("Ye rasid hamare record mein nahi hai");
  return r;
}, { auth: false });
