// Feature control → "Trust delete": remove one trust completely — every row under it (yojna, members,
// dues, payments, agents, commission, receipts, logins, WhatsApp, notifications…) AND every uploaded
// photo / document it points to. Steps: info (counts) → optional JSON backup → delete (e-mail typed).
import path from "node:path";
import { rm, unlink } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest, notFound } from "../lib/errors.js";
import { clearFeatureCache } from "./features.js";

// table → how its rows belong to a trust (all cascade from admins / programs on delete)
const BY_ADMIN = ["agents", "programs", "accounts", "agent_commissions", "agent_commission_payouts", "audit_logs", "cash_handovers",
  "certificate_templates", "master_data", "notifications", "payment_requests", "receipt_register", "roles", "whatsapp_messages"];
const BY_PROGRAM = ["closing_groups", "members", "dues", "transactions", "join_fee_payments", "member_advances"];
const LABEL = {
  programs: "Yojna", members: "Members", dues: "Dues", transactions: "Transactions", join_fee_payments: "Join fee", agents: "Agents",
  accounts: "Logins", agent_commissions: "Commission", agent_commission_payouts: "Payouts", payment_requests: "App payment requests",
  member_advances: "Advance", closing_groups: "Closing groups", receipt_register: "Rasid", cash_handovers: "Cash hisaab",
  whatsapp_messages: "WhatsApp", notifications: "Notifications", audit_logs: "Activity log", certificate_templates: "Certificate design",
  master_data: "Master data", roles: "Roles",
};
const rowsOf = (t, adminId) => (BY_PROGRAM.includes(t)
  ? sql`SELECT * FROM ${sql.identifier(t)} WHERE program_id IN (SELECT id FROM programs WHERE admin_id = ${adminId})`
  : sql`SELECT * FROM ${sql.identifier(t)} WHERE admin_id = ${adminId}`);

async function trust(adminId) {
  const { rows: [a] } = await db.execute(sql`SELECT id, email, display_name, trust_info->>'name' AS name, created_at FROM admins WHERE id = ${adminId}`);
  if (!a) throw notFound("Trust nahi mila (pehle hi delete?)");
  return a;
}

/* ── uploaded files the trust points to ───────────────────────────────── */
const mode = () => (process.env.STORAGE || "local").toLowerCase();
const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || "./uploads");
const s3Base = () => (process.env.S3_PUBLIC_URL || "").replace(/\/$/, "");
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** every storage key found in any text / json of the trust's rows (photos, documents, logos, screenshots, PDFs) */
export async function trustFileKeys(adminId) {
  const keys = new Set();
  const pats = [/\/api\/files\/([^"'\s?#\\]+)/g];
  if (s3Base()) pats.push(new RegExp(`${esc(s3Base())}/([^"'\\s?#\\\\]+)`, "g"));
  const scan = (text) => { for (const re of pats) for (const m of text.matchAll(re)) keys.add(decodeURIComponent(m[1])); };
  const { rows: [ad] } = await db.execute(sql`SELECT row_to_json(a)::text AS j FROM admins a WHERE id = ${adminId}`);
  if (ad) scan(ad.j);
  for (const t of [...BY_ADMIN, ...BY_PROGRAM]) {
    if (["accounts", "audit_logs", "dues"].includes(t)) continue; // no files there
    const q = BY_PROGRAM.includes(t)
      ? sql`SELECT row_to_json(x)::text AS j FROM ${sql.identifier(t)} x WHERE x.program_id IN (SELECT id FROM programs WHERE admin_id = ${adminId})`
      : sql`SELECT row_to_json(x)::text AS j FROM ${sql.identifier(t)} x WHERE x.admin_id = ${adminId}`;
    const { rows } = await db.execute(q);
    for (const r of rows) scan(r.j);
  }
  return [...keys].filter((k) => !k.includes("..") && !k.startsWith("/"));
}

/** What a delete would remove. */
export async function trustDeleteInfo(adminId) {
  const a = await trust(adminId);
  const counts = {};
  for (const t of [...BY_ADMIN, ...BY_PROGRAM]) {
    const q = BY_PROGRAM.includes(t)
      ? sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)} WHERE program_id IN (SELECT id FROM programs WHERE admin_id = ${adminId})`
      : sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)} WHERE admin_id = ${adminId}`;
    const { rows: [r] } = await db.execute(q);
    if (r.n) counts[t] = r.n;
  }
  const files = await trustFileKeys(adminId);
  const { rows: [money] } = await db.execute(sql`
    SELECT COALESCE(sum(t.amount) FILTER (WHERE t.status = 'completed'), 0)::bigint AS collected, max(t.created_at) AS "lastPayment"
    FROM transactions t JOIN programs p ON p.id = t.program_id WHERE p.admin_id = ${adminId}`);
  const { rows: [login] } = await db.execute(sql`SELECT max(last_login_at) AS at FROM accounts WHERE admin_id = ${adminId}`);
  return {
    id: a.id, email: a.email, name: a.name || a.display_name || a.email, createdAt: a.created_at,
    counts, labels: LABEL, files: files.length, storage: mode(), collected: Number(money.collected), lastPayment: money.lastPayment, lastLogin: login.at,
  };
}

/** Full JSON backup (every row of every table of the trust) — download before deleting. */
export async function trustBackup(adminId) {
  const a = await trust(adminId);
  const out = { format: "mgsf-trust-backup", version: 1, exportedAt: new Date().toISOString(), adminId, tables: {} };
  const { rows: ad } = await db.execute(sql`SELECT * FROM admins WHERE id = ${adminId}`);
  out.tables.admins = ad;
  for (const t of [...BY_ADMIN, ...BY_PROGRAM]) {
    const { rows } = await db.execute(rowsOf(t, adminId));
    if (t === "accounts") rows.forEach((r) => { delete r.password_hash; }); // never export password hashes
    if (rows.length) out.tables[t] = rows;
  }
  out.files = await trustFileKeys(adminId);
  return { json: JSON.stringify(out), name: `${String(a.name || a.email || adminId).replace(/[^\wऀ-ॿ-]+/g, "_").slice(0, 40)}-backup-${new Date().toISOString().slice(0, 10)}.json` };
}

async function deleteFiles(keys, adminId) {
  let removed = 0, failed = 0;
  if (mode() === "r2" || mode() === "s3") {
    const { S3Client, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({ region: process.env.S3_REGION || "auto", endpoint: process.env.S3_ENDPOINT,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
    for (let i = 0; i < keys.length; i += 1000) {
      const part = keys.slice(i, i + 1000);
      try {
        const r = await s3.send(new DeleteObjectsCommand({ Bucket: process.env.S3_BUCKET, Delete: { Objects: part.map((Key) => ({ Key })), Quiet: true } }));
        failed += r.Errors?.length || 0; removed += part.length - (r.Errors?.length || 0);
      } catch { failed += part.length; }
    }
  } else {
    const root = uploadDir();
    for (const k of keys) {
      const full = path.resolve(root, k);
      if (!full.startsWith(root + path.sep)) { failed++; continue; }
      await unlink(full).then(() => { removed++; }).catch((e) => { if (e.code !== "ENOENT") failed++; });
    }
    // the migration's own folder (uploads/<adminId>/…)
    if (/^[\w-]+$/.test(String(adminId))) await rm(path.join(root, String(adminId)), { recursive: true, force: true }).catch(() => {});
  }
  return { removed, failed };
}

/** confirm = trust admin e-mail. Database first (one transaction), then the files. */
export async function deleteTrust(adminId, { confirm, deleteFiles: withFiles = true } = {}, by = "control") {
  const info = await trustDeleteInfo(adminId);
  const ok = [info.email, info.id].filter(Boolean).map((v) => String(v).toLowerCase());
  if (!ok.includes(String(confirm || "").trim().toLowerCase())) throw badRequest(`Pakka karne ke liye trust ka admin e-mail likhein: ${info.email || info.id}`);
  const keys = withFiles ? await trustFileKeys(adminId) : [];
  const { rows: [busy] } = await db.execute(sql`SELECT count(*)::int AS n FROM migration_jobs WHERE target_admin_id = ${adminId} AND status = 'running' AND kind <> 'excel'`);
  if (busy.n) throw badRequest("Is trust ka migration abhi chal raha hai — pehle rokein");
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM admins WHERE id = ${adminId} FOR UPDATE`);
    // an owner login linked to this trust stays (owner of the whole panel), only unlinked
    await tx.execute(sql`UPDATE accounts SET admin_id = NULL WHERE admin_id = ${adminId} AND role = 'owner'`);
    await tx.execute(sql`DELETE FROM accounts WHERE admin_id = ${adminId}`);
    await tx.execute(sql`DELETE FROM admins WHERE id = ${adminId}`); // programs → members → dues / transactions…, agents, … cascade
    await tx.execute(sql`UPDATE migration_jobs SET logins_enc = NULL, report = report || jsonb_build_object('trustDeleted', true, 'trustDeletedAt', now()), updated_at = now()
      WHERE target_admin_id = ${adminId}`);
  });
  clearFeatureCache();
  const files = keys.length ? await deleteFiles(keys, adminId) : { removed: 0, failed: 0 };
  console.log(`[control] trust ${adminId} (${info.email}) deleted by ${by}: ${JSON.stringify(info.counts)} · files ${files.removed}/${keys.length}`);
  return { success: true, removed: info.counts, files: { ...files, total: keys.length } };
}
