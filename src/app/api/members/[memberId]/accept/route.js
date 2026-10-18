import { route, readJson } from "@/lib/http.js";
import { getMemberFor } from "@/lib/auth.js";
import { adminOnly, publicOrigin } from "@/lib/access.js";
import { acceptMember } from "@/services/members.js";
import { notifyAgent, later } from "@/lib/push.js";
import { onJoin } from "@/services/whatsapp.js";

/** Accept a pending request: reg number + login account + dues for current closings.
 *  Body (optional): fields from the accept dialog — joinFeesDone, joinFeesPaymentType, joinFeesPaidAmount, … */
export const POST = route(async ({ request, auth, params }) => {
  adminOnly(auth);
  const m = await getMemberFor(auth, params.memberId, { forWrite: true });
  const input = await readJson(request);
  const r = await acceptMember(params.memberId, input);
  if (m.agentId) {
    notifyAgent(m.program.adminId, m.agentId, {
      title: "मेंबर रिक्वेस्ट मंजूर",
      body: `${m.displayName} की मेंबर रिक्वेस्ट मंजूर कर दी गई है।\nमोबाइल: ${m.phone}\nगाँव: ${m.village}\nयोजना: ${m.program.name}\nRegistration: ${r.registrationNumber}`,
      data: { memberId: m.id },
    }).catch(() => {});
  }
  // "WhatsApp par bhejein" ticked in the accept dialog (default off)
  if (input.sendWhatsapp === true) later(() => onJoin(m.program.adminId, params.memberId, publicOrigin(request)));
  return r;
});
