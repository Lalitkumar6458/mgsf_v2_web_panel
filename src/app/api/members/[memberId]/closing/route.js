import { route, readJson } from "@/lib/http.js";
import { getMemberFor } from "@/lib/auth.js";
import { adminOnly, publicOrigin } from "@/lib/access.js";
import { onClosing } from "@/services/whatsapp.js";
import { recordClosing, updateClosing, revertClosing } from "@/services/closings.js";
import { later } from "@/lib/push.js";
import { notifyClosing } from "@/services/autoNotify.js";

/** Record marriage: { closingDate, closingGroupId?, closingNotes?, invitationCardUrl?, pdfData? } */
export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  const m = await getMemberFor(auth, params.memberId, { forWrite: true });
  const r = await recordClosing(params.memberId, await readJson(request));
  later(() => notifyClosing(m.program?.adminId || auth.adminId, params.memberId));
  later(() => onClosing(m.program?.adminId || auth.adminId, params.memberId, publicOrigin(request)));
  return r;
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
