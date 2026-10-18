// Panel → Settings → App logins: who uses the mobile app, on how many phones, and logging a phone out.
// A "phone" = an active session row: not logged out and used within the last 30 days (the login lifetime).
// Logging a phone out ends that session at once (its next request gets 401) and stops push to it.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { notFound } from "../lib/errors.js";

const ACTIVE = sql`s.revoked_at IS NULL AND s.last_seen_at > now() - interval '30 days'`;
const TOKEN = sql`s.push_token ~ '^Expo(nent)?PushToken\\['`;

/** The trust's app logins (members of its yojnas + its agents). */
function scope(adminId, role) {
  return sql`
    SELECT a.id, a.role::text AS role, a.login_id, a.display_name, a.active, a.last_login_at, a.member_id, a.agent_id,
           m.display_name AS member_name, m.registration_number, m.village, m.phone AS member_phone, p.name AS program,
           ag.display_name AS agent_name, ag.phone AS agent_phone
    FROM accounts a
    LEFT JOIN members m ON m.id = a.member_id
    LEFT JOIN programs p ON p.id = m.program_id
    LEFT JOIN agents ag ON ag.id = a.agent_id
    WHERE a.role::text = ${role}
      AND (a.admin_id = ${adminId} OR p.admin_id = ${adminId})
      AND (a.role <> 'member' OR (m.id IS NOT NULL AND NOT m.deleted))`;
}

/** Cards: members / agents — logins, logged in on the app, phones, push on, active this week. */
export async function loginSummary(adminId) {
  const out = {};
  for (const role of ["member", "agent"]) {
    const { rows: [r] } = await db.execute(sql`
      WITH acc AS (${scope(adminId, role)}),
      ph AS (
        SELECT s.account_id, count(*)::int AS phones, count(*) FILTER (WHERE ${TOKEN})::int AS push,
               max(s.last_seen_at) AS seen
        FROM sessions s JOIN acc ON acc.id = s.account_id WHERE ${ACTIVE} GROUP BY 1
      )
      SELECT count(*)::int AS logins,
             count(ph.account_id)::int AS logged_in,
             COALESCE(sum(ph.phones), 0)::int AS phones,
             COALESCE(sum(ph.push), 0)::int AS push,
             count(*) FILTER (WHERE ph.seen > now() - interval '7 days')::int AS active_week
      FROM acc LEFT JOIN ph ON ph.account_id = acc.id`);
    out[role === "member" ? "members" : "agents"] = r;
  }
  return out;
}

/** List: role, q, status "in" (logged in) | "out" (never / not now) | "" ; page of 50 */
export async function loginList(adminId, { role = "member", q = "", status = "", page = 1 } = {}) {
  const r = role === "agent" ? "agent" : "member";
  const like = q ? `%${String(q).trim()}%` : null;
  const size = 50, offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const { rows } = await db.execute(sql`
    WITH acc AS (${scope(adminId, r)}),
    ph AS (
      SELECT s.account_id, count(*)::int AS phones, count(*) FILTER (WHERE ${TOKEN})::int AS push, max(s.last_seen_at) AS seen
      FROM sessions s JOIN acc ON acc.id = s.account_id WHERE ${ACTIVE} GROUP BY 1
    )
    SELECT acc.*, COALESCE(ph.phones, 0) AS phones, COALESCE(ph.push, 0) AS push, ph.seen, count(*) OVER()::int AS total
    FROM acc LEFT JOIN ph ON ph.account_id = acc.id
    WHERE true
      ${status === "in" ? sql`AND ph.phones > 0` : status === "out" ? sql`AND ph.phones IS NULL` : sql``}
      ${like ? sql`AND (acc.member_name ILIKE ${like} OR acc.agent_name ILIKE ${like} OR acc.display_name ILIKE ${like}
                OR acc.login_id ILIKE ${like} OR acc.registration_number ILIKE ${like} OR acc.village ILIKE ${like}
                OR acc.member_phone ILIKE ${like} OR acc.agent_phone ILIKE ${like})` : sql``}
    ORDER BY (ph.seen IS NULL), ph.seen DESC NULLS LAST, COALESCE(acc.member_name, acc.agent_name, acc.display_name)
    LIMIT ${size} OFFSET ${offset}`);
  return {
    total: rows[0]?.total || 0, page: Number(page) || 1, pageSize: size,
    logins: rows.map((x) => ({
      accountId: x.id, role: x.role, loginId: x.login_id, active: x.active,
      name: x.member_name || x.agent_name || x.display_name || x.login_id,
      registrationNumber: x.registration_number || "", village: x.village || "", program: x.program || "",
      phone: x.member_phone || x.agent_phone || "",
      phones: x.phones, push: x.push, lastSeenAt: x.seen, lastLoginAt: x.last_login_at,
    })),
  };
}

async function ownAccount(adminId, accountId) {
  const { rows: [a] } = await db.execute(sql`
    SELECT a.id, a.role::text AS role FROM accounts a
    LEFT JOIN members m ON m.id = a.member_id LEFT JOIN programs p ON p.id = m.program_id
    WHERE a.id = ${accountId} AND a.role IN ('member', 'agent') AND (a.admin_id = ${adminId} OR p.admin_id = ${adminId})`);
  if (!a) throw notFound("Login nahi mila");
  return a;
}

/** The phones of one login. */
export async function loginPhones(adminId, accountId) {
  await ownAccount(adminId, accountId);
  const { rows } = await db.execute(sql`
    SELECT s.id, s.device, s.platform, s.app_version, s.user_agent, s.ip, s.created_at, s.last_seen_at, (${TOKEN}) AS push
    FROM sessions s WHERE s.account_id = ${accountId} AND ${ACTIVE} ORDER BY s.last_seen_at DESC`);
  return rows.map((s) => ({
    id: s.id,
    device: s.device || (/okhttp|Expo|CFNetwork|Darwin/i.test(s.user_agent || "") ? "Mobile app (purana version)" : (s.user_agent || "").slice(0, 60) || "—"),
    platform: s.platform, appVersion: s.app_version, ip: s.ip, loggedInAt: s.created_at, lastSeenAt: s.last_seen_at, push: Boolean(s.push),
  }));
}

/** Log one phone out (sessionId) or every phone of the login (all). → { loggedOut } */
export async function logoutPhones(adminId, accountId, { sessionId = null } = {}) {
  await ownAccount(adminId, accountId);
  const { rows } = await db.execute(sql`
    UPDATE sessions SET revoked_at = now(), push_token = NULL
    WHERE account_id = ${accountId} AND revoked_at IS NULL ${sessionId ? sql`AND id = ${sessionId}` : sql``}
    RETURNING id`);
  if (!sessionId || !(await loginPhones(adminId, accountId)).length) {
    await db.execute(sql`UPDATE accounts SET push_token = NULL WHERE id = ${accountId}`);
  }
  return { loggedOut: rows.length };
}
