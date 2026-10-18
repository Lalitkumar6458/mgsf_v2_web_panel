// Agent app: one request — read it, correct and send again (PUT), or withdraw it (DELETE).
import { sql, eq } from "drizzle-orm";
import { db, schema } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { conflict } from "@/lib/errors.js";
import { agentRequestRow, shapeMember } from "@/services/mobileApp.js";
import { updateMember, softDeleteMember } from "@/services/members.js";

export const GET = route(async ({ auth, params }) => {
  const m = await agentRequestRow(auth, params.id);
  const full = await db.query.members.findFirst({ where: eq(schema.members.id, m.id) });
  return { request: { ...shapeMember(m), ...full, aadhaarNo: full.aadhaarNo, status: m.status, rejectReason: m.extra?.statusReason || "" } };
});

export const PUT = route(async ({ auth, params, request }) => {
  const m = await agentRequestRow(auth, params.id);
  if (!["pending", "rejected"].includes(m.status)) throw conflict("स्वीकार हो चुके सदस्य को कार्यालय ही बदल सकता है");
  const body = await readJson(request);
  for (const k of ["agentId", "selectedAgent", "status", "registrationNumber", "programId"]) delete body[k];
  const member = await db.query.members.findFirst({ where: eq(schema.members.id, m.id) });
  member.program = await db.query.programs.findFirst({ where: eq(schema.programs.id, member.programId) });
  const r = await updateMember(member, body);
  if (m.status === "rejected") {
    await db.execute(sql`UPDATE members SET status = 'pending', updated_at = now(), extra = extra - 'statusReason' WHERE id = ${m.id}`);
    await db.insert(schema.notifications).values({ adminId: auth.adminId, accountId: null, title: "सदस्य अनुरोध दोबारा भेजा गया",
      body: `${r.member?.displayName || m.display_name} — एजेंट ${auth.displayName || ""}`, data: { memberId: m.id } });
  }
  return { success: true, id: m.id };
});

export const DELETE = route(async ({ auth, params }) => {
  const m = await agentRequestRow(auth, params.id);
  if (!["pending", "rejected"].includes(m.status)) throw conflict("स्वीकार हो चुका अनुरोध हटाया नहीं जा सकता");
  await softDeleteMember(m.id);
  return { success: true };
});
