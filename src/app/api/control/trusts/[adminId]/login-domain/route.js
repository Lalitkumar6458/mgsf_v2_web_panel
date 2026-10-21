// Feature control: which domain shows this trust's name + logo on the login page (and app welcome).
//   PUT { domains: ["admin.trust.in"], isDefault?: true }
import { route, readJson } from "@/lib/http.js";
import { requireControl } from "@/lib/controlAuth.js";
import { setLoginDomains } from "@/services/trust.js";

export const dynamic = "force-dynamic";
export const PUT = route(async ({ request, params }) => {
  await requireControl(request);
  const body = await readJson(request);
  return setLoginDomains(params.adminId, { domains: body.domains, isDefault: body.isDefault });
}, { auth: false });
