import { route, readJson } from "@/lib/http.js";
import { getMemberFor } from "@/lib/auth.js";
import { adminOnly } from "@/lib/access.js";
import { recordClosing, updateClosing, revertClosing } from "@/services/closings.js";

/** Record marriage: { closingDate, closingGroupId?, closingNotes?, invitationCardUrl?, pdfData? } */
export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  await getMemberFor(auth, params.memberId, { forWrite: true });
  return recordClosing(params.memberId, await readJson(request));
});

/** Edit closing (date change re-syncs dues) */
export const PATCH = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  await getMemberFor(auth, params.memberId, { forWrite: true });
  return updateClosing(params.memberId, await readJson(request));
});

/** Revert closing. DELETE ?force=1 when payments were already received */
export const DELETE = route(async ({ auth, params, query }) => {
  adminOnly(auth);
  await getMemberFor(auth, params.memberId, { forWrite: true });
  return revertClosing(params.memberId, { force: query.get("force") === "1" || query.get("force") === "true" });
});
