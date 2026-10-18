// Panel → "सूचना भेजें": an Expo push + inbox message to a chosen group of app logins.
//   to: "all" | "members" | "agents" | "dues" (members who owe — their amount is added) | "member" (memberIds) | "agent" (agentIds)
//   programId narrows members (and "dues") to one yojna.
// Members always reach their same-mobile family logins too (lib/push.js notifyMembers).
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest } from "../lib/errors.js";
import { deliver, notifyMembers, phoneTokens } from "../lib/push.js";

const TO = ["all", "members", "agents", "dues", "member", "agent"];
const inList = (ids) => sql.join(ids.map((x) => sql`${x}`), sql`, `);
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

function clean(input = {}) {
  const to = TO.includes(input.to) ? input.to : "all";
  const ids = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 500) : []);
  return { to, programId: input.programId ? String(input.programId) : null, memberIds: ids(input.memberIds), agentIds: ids(input.agentIds) };
}

/** Members in scope → [{ memberId, owed }] */
async function memberTargets(adminId, a) {
  if (a.to === "agents" || a.to === "agent") return [];
  if (a.to === "member") {
    if (!a.memberIds.length) return [];
    const { rows } = await db.execute(sql`
      SELECT m.id FROM members m JOIN programs p ON p.id = m.program_id
      WHERE p.admin_id = ${adminId} AND m.id IN (${inList(a.memberIds)}) AND NOT m.deleted`);
    return rows.map((r) => ({ memberId: r.id, owed: 0 }));
  }
  const { rows } = await db.execute(sql`
    SELECT m.id, COALESCE(x.owed, 0)::int AS owed
    FROM members m JOIN programs p ON p.id = m.program_id
    LEFT JOIN LATERAL (SELECT sum(d.amount - d.paid_amount) AS owed FROM dues d WHERE d.payer_member_id = m.id AND d.status <> 'paid') x ON true
    WHERE p.admin_id = ${adminId} AND NOT m.deleted AND m.status IN ('accepted', 'closed') AND NOT m.blocked
      ${a.programId ? sql`AND m.program_id = ${a.programId}` : sql``}`);
  return rows.filter((r) => a.to !== "dues" || r.owed > 0).map((r) => ({ memberId: r.id, owed: r.owed }));
}

async function agentAccounts(adminId, a) {
  if (!["all", "agents", "agent"].includes(a.to)) return [];
  if (a.to === "agent" && !a.agentIds.length) return [];
  const { rows } = await db.execute(sql`
    SELECT id, push_token FROM accounts WHERE admin_id = ${adminId} AND active AND role = 'agent'
      ${a.to === "agent" ? sql`AND agent_id IN (${inList(a.agentIds)})` : sql``}`);
  return rows;
}

/** How many logins / phones a send would reach (preview in the panel). */
export async function audience(adminId, input) {
  const a = clean(input);
  const members = await memberTargets(adminId, a);
  const agents = await agentAccounts(adminId, a);
  let memberLogins = 0, memberPhones = 0;
  if (members.length) {
    const ids = members.map((m) => m.memberId);
    const { rows } = await db.execute(sql`SELECT id FROM accounts WHERE role = 'member' AND active AND member_id IN (${inList(ids)})`);
    memberLogins = rows.length;
    const t = await phoneTokens(rows.map((r) => r.id));
    memberPhones = [...t.values()].reduce((n, set) => n + set.size, 0);
  }
  const at = agents.length ? await phoneTokens(agents.map((x) => x.id)) : new Map();
  return {
    members: members.length, memberLogins, memberPhones,
    agents: agents.length, agentPhones: [...at.values()].reduce((n, set) => n + set.size, 0),
  };
}

/** Send now → { batch, saved, devices, pushed, failed } */
export async function sendNotification(adminId, input, by = "") {
  const title = String(input?.title || "").trim().slice(0, 120);
  const body = String(input?.body || "").trim().slice(0, 1000);
  if (!title) throw badRequest("Title likhein");
  const a = clean(input);
  const batch = randomUUID();
  const data = { type: "broadcast", batch, to: a.to, ...(by ? { by } : {}) };
  const members = await memberTargets(adminId, a);
  const agents = await agentAccounts(adminId, a);
  if (!members.length && !agents.length) throw badRequest("Is group mein koi app login nahi mila");
  const r1 = await notifyMembers(adminId, members.map((m) => ({
    memberId: m.memberId, title,
    body: a.to === "dues" && m.owed > 0 ? `${body}${body ? "\n" : ""}आपका बकाया: ${inr(m.owed)}` : body,
    data,
  })));
  const r2 = await deliver(adminId, agents.map((x) => ({ accountId: x.id, title, body, data })));
  return {
    batch,
    saved: r1.saved + r2.saved, devices: r1.devices + r2.devices, pushed: r1.pushed + r2.pushed, failed: r1.failed + r2.failed,
  };
}

/** Last sends from the panel (grouped by batch) with read counts. */
export async function sentList(adminId, limit = 30) {
  const { rows } = await db.execute(sql`
    SELECT data->>'batch' AS batch, min(title) AS title, min(body) AS body, min(data->>'to') AS "to",
           min(created_at) AS sent_at, count(*)::int AS logins, count(read_at)::int AS read
    FROM notifications
    WHERE admin_id = ${adminId} AND account_id IS NOT NULL AND data->>'type' = 'broadcast'
    GROUP BY 1 ORDER BY 5 DESC LIMIT ${Math.min(Number(limit) || 30, 100)}`);
  return rows.map((r) => ({ batch: r.batch, title: r.title, body: r.body, to: r.to, sentAt: r.sent_at, logins: r.logins, read: r.read }));
}
