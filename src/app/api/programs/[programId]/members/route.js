import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { getProgramFor } from "@/lib/auth.js";
import { forbidden } from "@/lib/errors.js";
import { createMember, listMembers } from "@/services/members.js";
import { notifyAgent, later } from "@/lib/push.js";
import { publicOrigin } from "@/lib/access.js";
import { onJoin } from "@/services/whatsapp.js";

/** GET ?status=&agentId=&q=&closed=true|false&page=&pageSize=&sort=newest|name|regno|application */
export const GET = route(async ({ auth, params, query }) => {
  await getProgramFor(auth, params.programId);
  if (auth.role === "member") throw forbidden();
  const opts = Object.fromEntries(query.entries());
  if (auth.role === "agent") opts.agentId = auth.agentId;
  return listMembers(params.programId, opts);
});

/** Admin: member is accepted at once. Agent: pending request. */
export const POST = route(async ({ request, auth, params }) => {
  const program = await getProgramFor(auth, params.programId);
  if (auth.role === "member") throw forbidden();
  const input = await readJson(request);
  const r = await createMember(program, input, auth);

  const m = r.member;
  const body = `${m.displayName}\nमोबाइल: ${m.phone}\nगाँव: ${m.village}\nयोजना: ${program.name}\nएप्लीकेशन नंबर: ${m.applicationNumber}`;
  if (auth.role === "agent") {
    // shows up in the admin panel's notification list
    await db.insert(schema.notifications).values({ adminId: program.adminId, accountId: null, title: "नया सदस्य अनुरोध", body, data: { memberId: m.id } });
  } else if (m.agentId) {
    notifyAgent(program.adminId, m.agentId, { title: "नया सदस्य जोड़ दिया गया", body, data: { memberId: m.id } }).catch(() => {});
  }
  // accepted straight away + "WhatsApp par bhejein" ticked → welcome with the certificate
  if (r.member?.status === "accepted" && input.sendWhatsapp === true) later(() => onJoin(program.adminId, m.id, publicOrigin(request)));
  return r;
});
