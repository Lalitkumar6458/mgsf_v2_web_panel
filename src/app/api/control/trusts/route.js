// Secret feature control: every trust with its feature lock.
import { route } from "@/lib/http.js";
import { requireControl } from "@/lib/controlAuth.js";
import { listTrustFeatures } from "@/services/features.js";

export const dynamic = "force-dynamic";

export const GET = route(async ({ request }) => {
  await requireControl(request);
  return { trusts: await listTrustFeatures() };
}, { auth: false });
