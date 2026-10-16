// Audit log — who changed what, and when (Settings → Activity log).
//
// Every successful change made through the API route wrapper (lib/http.js) is written here
// automatically: POST / PUT / PATCH / DELETE by a logged-in trust user. Reading never is.
// Writing the log never blocks or breaks the request (fire-and-forget, errors only logged).
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

// paths that are not "changes" worth a log line
const SKIP = [/^\/auth\//, /^\/upload$/, /^\/files\//, /^\/notifications/, /^\/receipts\/(jobs|preview)/, /^\/control\//, /^\/email-send$/];
const SECRET_KEYS = /pass(word)?|otp|token|secret|key$/i;

const ENTITY_LABEL = {
  member: "Member", payment: "Payment", transaction: "Payment", joinFee: "Join fees", agent: "Agent", yojna: "Yojna",
  closing: "Closing", closingGroup: "Closing group", user: "Staff user", role: "Role", master: "Master data",
  trust: "Trust settings", theme: "Theme", certificate: "Certificate design", commission: "Commission",
  cash: "Cash handover", receipt: "Receipt", due: "Due",
};
export const AUDIT_ENTITIES = Object.entries(ENTITY_LABEL).map(([value, label]) => ({ value, label }));

const ACTION_LABEL = { create: "Banaya", update: "Badla", delete: "Hataya", reverse: "Wapas kiya", accept: "Accept kiya", login: "Login", status: "Status badla" };
export const AUDIT_ACTIONS = Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }));

const verb = { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };

/** API path + method → { action, entity, entityId } (null = do not log) */
export function describeRequest(method, pathname) {
  const p = pathname.replace(/^\/api/, "").replace(/\/+$/, "");
  const m = String(method).toUpperCase();
  if (!verb[m] || SKIP.some((re) => re.test(p))) return null;
  const act = verb[m];
  const seg = p.split("/").filter(Boolean);
  const hit = (re) => p.match(re);
  let r;
  if ((r = hit(/^\/transactions\/([^/]+)\/reverse$/))) return { action: "reverse", entity: "payment", entityId: r[1] };
  if ((r = hit(/^\/members\/([^/]+)\/accept$/))) return { action: "accept", entity: "member", entityId: r[1] };
  if ((r = hit(/^\/members\/([^/]+)\/status$/))) return { action: "status", entity: "member", entityId: r[1] };
  if ((r = hit(/^\/members\/([^/]+)\/reset-password$/))) return { action: "update", entity: "member", entityId: r[1], what: "password reset" };
  if ((r = hit(/^\/members\/([^/]+)\/closing$/))) return { action: act === "delete" ? "reverse" : "create", entity: "closing", entityId: r[1] };
  if ((r = hit(/^\/members\/([^/]+)\/(dues|closing-dues)/))) return { action: act, entity: "due", entityId: r[1] };
  if ((r = hit(/^\/members\/([^/]+)\/join-fees$/))) return { action: act, entity: "joinFee", entityId: r[1] };
  if ((r = hit(/^\/members\/([^/]+)$/))) return { action: act, entity: "member", entityId: r[1] };
  if ((r = hit(/^\/programs\/([^/]+)\/members(\/.*)?$/))) return { action: act, entity: "member", entityId: "", programId: r[1] };
  if ((r = hit(/^\/programs\/([^/]+)\/receipts$/))) return { action: "create", entity: "receipt", entityId: "", programId: r[1], what: "rasid PDF banayi" };
  if ((r = hit(/^\/programs\/([^/]+)\/payments$/)) || hit(/^\/payments\/process$/)) return { action: "create", entity: "payment", entityId: "", programId: r?.[1] };
  if ((r = hit(/^\/programs\/([^/]+)\/join-fees$/))) return { action: act, entity: "joinFee", entityId: "", programId: r[1] };
  if ((r = hit(/^\/join-fees\/([^/]+)$/))) return { action: act, entity: "joinFee", entityId: r[1] };
  if ((r = hit(/^\/programs\/([^/]+)\/(closings)$/))) return { action: act, entity: "closing", entityId: "", programId: r[1] };
  if ((r = hit(/^\/programs\/([^/]+)\/closing-groups$/))) return { action: act, entity: "closingGroup", entityId: "", programId: r[1] };
  if ((r = hit(/^\/programs\/([^/]+)\/cash-handovers(\/([^/]+))?$/))) return { action: act, entity: "cash", entityId: r[3] || "", programId: r[1] };
  if ((r = hit(/^\/programs\/([^/]+)$/)) || hit(/^\/programs$/)) return { action: act, entity: "yojna", entityId: r?.[1] || "" };
  if ((r = hit(/^\/agents\/([^/]+)\/commission/)) || hit(/^\/commission-payouts\//)) return { action: act, entity: "commission", entityId: r?.[1] || seg[1] || "" };
  if ((r = hit(/^\/agents(\/([^/]+))?$/))) return { action: act, entity: "agent", entityId: r[2] || "" };
  if ((r = hit(/^\/users(\/([^/]+))?/))) return { action: act, entity: "user", entityId: r[2] || "" };
  if ((r = hit(/^\/roles(\/([^/]+))?/))) return { action: act, entity: "role", entityId: r[2] || "" };
  if (hit(/^\/master-data/)) return { action: act, entity: "master", entityId: seg[1] || "" };
  if (hit(/^\/trust\/theme$/)) return { action: "update", entity: "theme", entityId: "" };
  if (hit(/^\/trust$/)) return { action: "update", entity: "trust", entityId: "" };
  if (hit(/^\/certificate-templates/)) return { action: act, entity: "certificate", entityId: seg[1] || "" };
  return { action: act, entity: seg[0] || "", entityId: seg[1] || "" };
}

/** Strip secrets, images and huge values so a log row stays small and safe. */
export function cleanDetails(body, depth = 0) {
  if (body == null || depth > 3) return undefined;
  if (typeof body === "string") return body.startsWith("data:") ? "[file]" : body.slice(0, 300);
  if (typeof body !== "object") return body;
  if (Array.isArray(body)) return body.length > 20 ? `[${body.length} items]` : body.map((v) => cleanDetails(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (SECRET_KEYS.test(k)) { out[k] = "•••"; continue; }
    const c = cleanDetails(v, depth + 1);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

const pickName = (b) => {
  if (!b || typeof b !== "object") return "";
  return String(b.displayName || b.name || b.memberName || b.payerName || b.title || b.label || b.registrationNumber || "").slice(0, 80);
};
const pickAmount = (b) => (b && typeof b === "object" && Number(b.amount) > 0 ? Number(b.amount) : null);

export function summarize(d, body, result) {
  const ent = ENTITY_LABEL[d.entity] || d.entity || "Record";
  const act = ACTION_LABEL[d.action] || d.action;
  const name = pickName(body) || pickName(result?.member) || pickName(result?.agent) || pickName(result?.program) || "";
  const amt = pickAmount(body);
  const count = Array.isArray(body?.items) ? body.items.length : Array.isArray(body?.payments) ? body.payments.length : Array.isArray(body?.dueIds) ? body.dueIds.length : 0;
  return [`${ent} ${act.toLowerCase()}`, name && `— ${name}`, d.what && `(${d.what})`, amt && `₹${amt.toLocaleString("en-IN")}`, count > 1 && `${count} entries`]
    .filter(Boolean).join(" ");
}

/** Write one log line. Never throws. */
export async function writeAudit({ adminId, auth, action, entity = "", entityId = "", summary = "", details = {}, ip = "" }) {
  try {
    if (!adminId) return;
    await db.execute(sql`
      INSERT INTO audit_logs (admin_id, account_id, actor_name, actor_role, action, entity, entity_id, summary, details, ip)
      VALUES (${adminId}, ${auth?.accountId || ""}, ${auth?.displayName || ""}, ${auth?.access?.roleName || auth?.role || ""},
        ${action}, ${entity}, ${String(entityId || "")}, ${summary.slice(0, 300)}, ${JSON.stringify(details || {})}::jsonb, ${ip})`);
  } catch (e) {
    console.error("[audit] not written:", e.message);
  }
}

/** Called by the route wrapper after a successful change. */
export function auditRequest({ auth, request, body, result, ip }) {
  if (!auth?.adminId || !["admin", "agent", "owner"].includes(auth.role)) return;
  const url = new URL(request.url);
  const d = describeRequest(request.method, url.pathname);
  if (!d) return;
  const entityId = d.entityId || result?.id || result?.member?.id || result?.agent?.id || result?.program?.id || result?.transaction?.id || "";
  writeAudit({
    adminId: auth.adminId, auth, action: d.action, entity: d.entity, entityId,
    summary: summarize(d, body, result),
    details: { path: url.pathname, method: request.method, ...(d.programId ? { programId: d.programId } : {}), body: cleanDetails(body) },
    ip,
  });
}

/** List for the Activity log screen. filters: { q, entity, action, accountId, from, to, page, pageSize } */
export async function listAudit(adminId, { q = "", entity = "", action = "", accountId = "", from = "", to = "", page = 1, pageSize = 50 } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const where = sql`admin_id = ${adminId}
    ${entity ? sql`AND entity = ${entity}` : sql``}
    ${action ? sql`AND action = ${action}` : sql``}
    ${accountId ? sql`AND account_id = ${accountId}` : sql``}
    ${from ? sql`AND created_at >= (${from}::date::timestamp AT TIME ZONE 'Asia/Kolkata')` : sql``}
    ${to ? sql`AND created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')` : sql``}
    ${q ? sql`AND (summary ILIKE ${"%" + q + "%"} OR actor_name ILIKE ${"%" + q + "%"} OR entity_id = ${q})` : sql``}`;
  const { rows } = await db.execute(sql`
    SELECT id::text, account_id, actor_name, actor_role, action, entity, entity_id, summary, details, ip, created_at,
      count(*) OVER()::int AS total
    FROM audit_logs WHERE ${where}
    ORDER BY created_at DESC, id DESC LIMIT ${size} OFFSET ${offset}`);
  const total = rows[0]?.total || 0;
  const { rows: actors } = await db.execute(sql`
    SELECT account_id, max(actor_name) AS name, count(*)::int AS n FROM audit_logs WHERE admin_id = ${adminId}
    GROUP BY account_id ORDER BY n DESC LIMIT 50`);
  return {
    total, page: Number(page) || 1, pageSize: size,
    logs: rows.map((r) => ({
      id: r.id, accountId: r.account_id, actorName: r.actor_name, actorRole: r.actor_role, action: r.action,
      entity: r.entity, entityId: r.entity_id, summary: r.summary, details: r.details, ip: r.ip, createdAt: r.created_at,
    })),
    actors: actors.map((a) => ({ accountId: a.account_id, name: a.name || "—", count: a.n })),
  };
}
