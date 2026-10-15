import { route } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { setDefaultTemplate } from "@/services/certificateTemplates.js";

/** POST — make this the trust's default certificate design. */
export const POST = route(async ({ auth, params }) => {
  adminOnly(auth);
  return { success: true, template: await setDefaultTemplate(auth.adminId, params.id, auth.accountId) };
});
