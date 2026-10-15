import { sql, eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { hashPassword } from "../lib/auth.js";
import { toDate, fmtISO } from "../lib/dates.js";
import { camel } from "../lib/case.js";
import { normalizeCommission } from "../lib/commission.js";

const { agents, accounts } = schema;
const FIELDS = ["displayName", "agentCode", "email", "phone", "address", "city", "state", "pinCode", "photoUrl", "signatureUrl"];

function pickAgent(body) {
  const out = {};
  if (body.photoURL && !body.photoUrl) body.photoUrl = body.photoURL;
  if (body.signatureURL && !body.signatureUrl) body.signatureUrl = body.signatureURL;
  for (const k of FIELDS) if (body[k] !== undefined) out[k] = String(body[k] ?? "").trim();
  if (out.email) out.email = out.email.toLowerCase();
  if (Array.isArray(body.documentUrls ?? body.documentURLs)) out.documentUrls = body.documentUrls ?? body.documentURLs;
  if (body.dateJoin !== undefined) out.dateJoin = fmtISO(toDate(body.dateJoin)) || null;
  // commission settings (Add / Edit agent form)
  if (body.commission !== undefined) out.commission = normalizeCommission(body.commission);
  if (body.oldAgentId !== undefined || body.extra) {
    out.extra = { ...(body.extra || {}), ...(body.oldAgentId !== undefined ? { oldAgentId: String(body.oldAgentId || "") } : {}) };
  }
  return out;
}

export async function listAgents(adminId, { includeDeleted = false, programId } = {}) {
  const { rows } = await db.execute(sql`
    SELECT a.*,
      (SELECT count(*) FROM members m WHERE m.agent_id = a.id AND NOT m.deleted
         AND m.status = 'accepted' AND m.active AND NOT m.blocked
         ${programId ? sql`AND m.program_id = ${programId}` : sql``})::int AS active_members,
      (SELECT count(*) FROM members m WHERE m.agent_id = a.id AND NOT m.deleted AND m.status = 'pending'
         ${programId ? sql`AND m.program_id = ${programId}` : sql``})::int AS pending_requests,
      acc.active AS login_active, acc.last_login_at
    FROM agents a LEFT JOIN accounts acc ON acc.agent_id = a.id
    WHERE a.admin_id = ${adminId} ${includeDeleted ? sql`` : sql`AND NOT a.deleted`}
    ORDER BY a.display_name`);
  return camel(rows);
}

/** Create agent + login (loginId = email). */
export async function createAgent(adminId, body) {
  const f = pickAgent(body);
  if (!f.displayName) throw badRequest("displayName required");
  if (!f.email) throw badRequest("email required (used for login)");
  if (!body.password || String(body.password).length < 6) throw badRequest("password (6+ chars) required");
  const taken = await db.query.accounts.findFirst({ where: eq(accounts.loginId, f.email) });
  if (taken) throw conflict("Email already used by another login");
  return db.transaction(async (tx) => {
    const [a] = await tx.insert(agents).values({ ...f, adminId }).returning();
    await tx.insert(accounts).values({
      role: "agent", loginId: f.email, email: f.email, phone: f.phone || "", displayName: f.displayName,
      passwordHash: await hashPassword(body.password), adminId, agentId: a.id,
    });
    return a;
  });
}

export async function getAgent(adminId, agentId) {
  const a = await db.query.agents.findFirst({ where: and(eq(agents.id, agentId), eq(agents.adminId, adminId)) });
  if (!a) throw notFound("Agent not found");
  return a;
}

export async function updateAgent(adminId, agentId, body) {
  await getAgent(adminId, agentId);
  const f = pickAgent(body);
  if (body.active !== undefined) f.active = !!body.active;
  const [a] = await db.update(agents).set(f).where(eq(agents.id, agentId)).returning();
  const accPatch = {};
  if (f.displayName) accPatch.displayName = f.displayName;
  if (f.phone !== undefined) accPatch.phone = f.phone;
  if (f.email) { accPatch.email = f.email; accPatch.loginId = f.email; }
  if (body.active !== undefined) accPatch.active = !!body.active;
  if (body.password) accPatch.passwordHash = await hashPassword(body.password);
  if (Object.keys(accPatch).length) await db.update(accounts).set(accPatch).where(eq(accounts.agentId, agentId));
  // keep the "added by" name on members in sync
  if (f.displayName) await db.execute(sql`UPDATE members SET added_by_name = ${f.displayName} WHERE agent_id = ${agentId}`);
  return a;
}

/** Soft delete; optionally move his members to another agent first. */
export async function deleteAgent(adminId, agentId, { moveMembersTo } = {}) {
  await getAgent(adminId, agentId);
  if (moveMembersTo) {
    const to = await getAgent(adminId, moveMembersTo);
    await db.execute(sql`UPDATE members SET agent_id = ${to.id}, added_by_name = ${to.displayName} WHERE agent_id = ${agentId}`);
  }
  await db.update(agents).set({ deleted: true, active: false }).where(eq(agents.id, agentId));
  await db.update(accounts).set({ active: false }).where(eq(accounts.agentId, agentId));
  return { success: true };
}
