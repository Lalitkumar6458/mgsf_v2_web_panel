// Secret feature control: PUT { flags, active, message } → replace one trust's feature lock.
import { route, readJson } from "@/lib/http.js";
import { requireControl } from "@/lib/controlAuth.js";
import { saveTrustFeatures } from "@/services/features.js";
import { clientIp } from "@/lib/access.js";

export const dynamic = "force-dynamic";

export const PUT = route(async ({ request, params }) => {
  await requireControl(request);
  const body = await readJson(request);
  const features = await saveTrustFeatures(params.adminId, body, `control@${clientIp(request) || "?"}`);
  return { success: true, features };
}, { auth: false });
