// POST { memberIds } → every open due of these members + their advance (bulk payment screen, one call).
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { assertAgentMembers } from "@/lib/access.js";
import { forbidden } from "@/lib/errors.js";
import { openDuesFor } from "@/services/payments.js";

export const dynamic = "force-dynamic";
export const POST = route(async ({ auth, params, request }) => {
  await getProgramFor(auth, params.programId);
  if (auth.role === "member") throw forbidden();
  const { memberIds = [] } = await readJson(request);
  await assertAgentMembers(auth, params.programId, memberIds);
  const r = await openDuesFor(params.programId, memberIds);
  if (auth.features?.advancePayment === false) for (const m of Object.values(r.members)) m.advance = 0;
  return r;
});
