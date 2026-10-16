// Public: GET /api/verify/c/<token> — the member behind a certificate QR (no login).
import { route } from "@/lib/http.js";
import { notFound } from "@/lib/errors.js";
import { verifyCertificate } from "@/services/verify.js";

export const dynamic = "force-dynamic";
export const GET = route(async ({ params }) => {
  const r = await verifyCertificate(decodeURIComponent(params.token));
  if (!r) throw notFound("Ye certificate hamare record mein nahi hai");
  return r;
}, { auth: false });
