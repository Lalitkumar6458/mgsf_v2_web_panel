import { route } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { aadhaarTaken } from "@/services/members.js";

/** GET ?aadhaarNo=…&exceptId=…&onlyActive=1 (only accepted/closed members count) */
export const GET = route(async ({ auth, params, query }) => {
  await getProgramFor(auth, params.programId);
  const m = await aadhaarTaken(params.programId, query.get("aadhaarNo"), query.get("exceptId"), { onlyActive: query.get("onlyActive") === "1" });
  return { exists: !!m, member: m };
});
