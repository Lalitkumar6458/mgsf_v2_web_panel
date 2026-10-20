// Migration runs: connect to a Firebase project with its service-account key, list its trusts, then run
// read → check → write → files → verify in the background with live progress in `migration_jobs`.
//
// The key is NEVER saved (not in the database, not on disk): it lives in this server process only, for
// 3 hours after "Connect", and is dropped when the run ends. A server restart forgets it — connect again.
import { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { clearFeatureCache } from "../features.js";
import * as mgsf from "./sourceMgsf.js";
import * as trustNew from "./sourceTrustNew.js";
import { reconcile } from "./reconcile.js";
import { fitInts } from "./common.js";
import { writeBundle, trustExists } from "./writer.js";
import { copyFiles } from "./files.js";
import { verifyTrust } from "./verify.js";

export const SOURCES = { [mgsf.KIND]: mgsf, [trustNew.KIND]: trustNew };
const g = globalThis;
const connections = (g.__mgsfMigConn ??= new Map()); // id → { kind, app, fsdb, auth, storage, projectId, at }
const running = (g.__mgsfMigRun ??= new Map());      // jobId → { cancel: false }
const CONN_TTL = 3 * 3600e3;

/* ── passwords file: encrypted with JWT_SECRET ─────────────────────────── */
const encKey = () => createHash("sha256").update(`${process.env.JWT_SECRET || "dev"}:migration-logins`).digest();
export function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
export function decrypt(blob) {
  const [iv, tag, data] = String(blob).split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

/* ── connect ─────────────────────────────────────────────────────────── */
function cleanup() {
  const now = Date.now();
  for (const [id, c] of connections) if (now - c.at > CONN_TTL) { connections.delete(id); c.close?.().catch?.(() => {}); }
}

export function parseServiceAccount(raw) {
  let sa = raw;
  if (typeof raw === "string") { try { sa = JSON.parse(raw); } catch { throw badRequest("Ye sahi service-account JSON nahi hai"); } }
  if (!sa || sa.type !== "service_account" || !sa.project_id || !sa.private_key || !sa.client_email) {
    throw badRequest("Firebase → Project settings → Service accounts → \"Generate new private key\" wali JSON file dein");
  }
  return sa;
}

/** A JSON backup instead of a live key: { users: [...] } (old panel, scripts/migrate-from-firestore.js --export-json) or { trusts: [...] }. */
function connectBackup(kind, backup) {
  let data = backup;
  if (typeof backup === "string") { try { data = JSON.parse(backup); } catch { throw badRequest("Backup JSON padh nahi paye"); } }
  const list = kind === "mgsf" ? data?.users : data?.trusts || (data?.id && data?.programs ? [data] : null);
  if (!Array.isArray(list) || !list.length) throw badRequest(kind === "mgsf" ? "Backup mein users[] nahi mila" : "Backup mein trusts[] nahi mila");
  const raw = new Map(list.map((t) => [String(t.id), t]));
  const id = randomUUID();
  connections.set(id, { kind, raw, projectId: "json-backup", at: Date.now() });
  const trusts = list.map((t) => {
    const progs = t.programs || [];
    const members = kind === "mgsf" ? progs.reduce((a, p) => a + (p._members?.length || 0), 0) : (t.members || []).length;
    const name = kind === "mgsf"
      ? (t.organizations || []).find((o) => o.id === "trustInfo")?.trustName || t.data?.displayName || t.data?.email || t.id
      : t.data?.branding?.nameHi || t.data?.branding?.nameEn || t.id;
    return { id: String(t.id), name: String(name), email: String((kind === "mgsf" ? t.data?.email || t.authEmail : t.users?.find((u) => u.email)?.email) || ""), programs: progs.length, members };
  });
  return { connectionId: id, projectId: "json-backup", kind, label: SOURCES[kind].LABEL, trusts };
}

export async function connect({ kind, serviceAccount, backup }) {
  cleanup();
  const src = SOURCES[kind];
  if (!src) throw badRequest("Source chunein");
  if (backup) {
    const r = connectBackup(kind, backup);
    for (const t of r.trusts) t.inPanel = (await trustExists(t.id, t.email)).some((x) => x.id === t.id);
    return r;
  }
  const sa = parseServiceAccount(serviceAccount);
  const { initializeApp, cert, deleteApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  const { getStorage } = await import("firebase-admin/storage");
  const name = `mig-${randomUUID()}`;
  const app = initializeApp({ credential: cert(sa), projectId: sa.project_id, storageBucket: sa.storage_bucket || `${sa.project_id}.appspot.com` }, name);
  const fsdb = getFirestore(app);
  let trusts;
  try {
    trusts = await src.listTrusts(fsdb);
  } catch (e) {
    await deleteApp(app).catch(() => {});
    throw badRequest(`Firebase se jud nahi paye: ${String(e?.message || e).slice(0, 200)}`);
  }
  const id = randomUUID();
  connections.set(id, { kind, app, fsdb, auth: getAuth(app), storage: getStorage(app), projectId: sa.project_id, at: Date.now(), close: () => deleteApp(app) });
  for (const t of trusts) {
    const ex = await trustExists(t.id, t.email);
    t.inPanel = ex.some((x) => x.id === t.id);
  }
  return { connectionId: id, projectId: sa.project_id, kind, label: src.LABEL, trusts };
}

/* ── job rows ────────────────────────────────────────────────────────── */
const STEP_LABELS = {
  read: "Firebase se padhna", check: "Jaanch (mapping + hisaab milaan)", write: "Database mein likhna",
  files: "Photo / document copy", verify: "Import ke baad jaanch",
};
function newSteps(dry, files) {
  return ["read", "check", "write", "files", "verify"].map((key) => ({
    key, label: STEP_LABELS[key], status: dry && key !== "read" && key !== "check" ? "skip" : !files && key === "files" ? "skip" : "wait", done: 0, total: 0, note: "",
  }));
}

class Job {
  constructor(row) { this.row = row; this.flushAt = 0; this.pending = null; this.logs = []; }
  step(key, patch) {
    const s = this.row.steps.find((x) => x.key === key);
    if (s) Object.assign(s, patch);
    this.flush();
  }
  log(msg, level = "info") {
    this.row.log.push({ t: new Date().toISOString(), level, msg: String(msg).slice(0, 500) });
    if (this.row.log.length > 400) this.row.log.splice(0, this.row.log.length - 400);
    this.flush();
  }
  flush(force = false) {
    const now = Date.now();
    if (!force && now - this.flushAt < 700) { this.pending ??= setTimeout(() => { this.pending = null; this.flush(true); }, 750); return; }
    this.flushAt = now;
    const r = this.row;
    return db.execute(sql`
      UPDATE migration_jobs SET status = ${r.status}, steps = ${JSON.stringify(r.steps)}::jsonb, log = ${JSON.stringify(r.log)}::jsonb,
        report = ${JSON.stringify(r.report)}::jsonb, error = ${r.error || ""}, target_admin_id = ${r.target_admin_id || null},
        finished_at = ${r.finished_at || null}, updated_at = now()
      WHERE id = ${r.id}`).catch((e) => console.error("[migration] flush", e.message));
  }
}

export async function listJobs(limit = 30) {
  const { rows } = await db.execute(sql`
    SELECT id, kind, source_project, source_trust_id, source_trust_name, target_admin_id, mode, dry_run, status, error, report->'counts' AS counts,
           report->'verify'->'ok' AS verified, COALESCE((report->>'reverted')::boolean, false) AS reverted, (logins_enc IS NOT NULL) AS has_logins, started_at, finished_at, created_by
    FROM migration_jobs WHERE kind <> 'excel' ORDER BY started_at DESC LIMIT ${Math.min(Number(limit) || 30, 100)}`);
  return rows.map((r) => ({ ...r, status: r.status === "running" && !running.has(r.id) ? "failed" : r.status }));
}

export async function getJob(id) {
  const { rows: [r] } = await db.execute(sql`SELECT * FROM migration_jobs WHERE id = ${id}`);
  if (!r) throw notFound("Job nahi mila");
  if (r.status === "running" && !running.has(r.id)) { r.status = "failed"; r.error = r.error || "Server restart ho gaya — dobara chalayein (\"Pehle wala hata kar dobara\")"; }
  const { logins_enc, ...rest } = r;
  return { ...rest, hasLogins: !!logins_enc, running: running.has(r.id) };
}

/* ── revert: remove the trust a migration wrote (galti se migrate ho gaya) ─────────────── */
async function revertable(id) {
  const { rows: [r] } = await db.execute(sql`SELECT * FROM migration_jobs WHERE id = ${id}`);
  if (!r) throw notFound("Job nahi mila");
  if (r.kind === "excel") throw badRequest("Excel import ka Undo Members page par hai");
  if (r.dry_run) throw badRequest("Dry run ne kuch likha hi nahi — hatane ko kuch nahi");
  if (running.has(r.id)) throw badRequest("Migration abhi chal raha hai — pehle rokein");
  if (r.report?.reverted) throw badRequest("Ye migration pehle hi hata diya gaya");
  if (r.status !== "done" || !r.target_admin_id) throw badRequest("Ye migration poora nahi hua — database mein kuch nahi likha gaya, hatane ko kuch nahi");
  const { rows: [later] } = await db.execute(sql`
    SELECT id FROM migration_jobs WHERE target_admin_id = ${r.target_admin_id} AND id <> ${r.id} AND NOT dry_run AND kind <> 'excel'
      AND status = 'done' AND started_at > ${r.started_at} AND NOT COALESCE((report->>'reverted')::boolean, false) LIMIT 1`);
  if (later) throw badRequest("Is trust ka baad mein dobara migration hua hai — sabse naye wale ko hatayein");
  return r;
}

/** What a revert would delete + what was added in the panel after the migration. */
export async function revertInfo(id) {
  const r = await revertable(id);
  const a = r.target_admin_id, since = r.finished_at || r.updated_at;
  const { rows: [x] } = await db.execute(sql`
    SELECT (SELECT display_name FROM admins WHERE id = ${a}) AS name, (SELECT email FROM admins WHERE id = ${a}) AS email,
      (SELECT count(*)::int FROM programs WHERE admin_id = ${a}) AS programs,
      (SELECT count(*)::int FROM members m JOIN programs p ON p.id = m.program_id WHERE p.admin_id = ${a}) AS members,
      (SELECT count(*)::int FROM transactions t JOIN programs p ON p.id = t.program_id WHERE p.admin_id = ${a}) AS transactions,
      (SELECT count(*)::int FROM accounts WHERE admin_id = ${a}) AS logins,
      (SELECT count(*)::int FROM members m JOIN programs p ON p.id = m.program_id WHERE p.admin_id = ${a} AND m.created_at > ${since}::timestamptz + interval '2 minutes') AS "newMembers",
      (SELECT count(*)::int FROM transactions t JOIN programs p ON p.id = t.program_id WHERE p.admin_id = ${a} AND t.created_at > ${since}::timestamptz + interval '2 minutes') AS "newTransactions"`);
  if (!x.name && !x.email) throw badRequest("Ye trust ab panel mein hai hi nahi (pehle hi hata diya?)");
  return { jobId: r.id, adminId: a, ...x, replaced: r.mode === "replace" };
}

/** confirm = trust admin e-mail (typed by the user). Deletes the trust + everything under it, in one transaction. */
export async function revertJob(id, { confirm } = {}) {
  const info = await revertInfo(id);
  const ok = [info.email, info.adminId].filter(Boolean).map((v) => String(v).toLowerCase());
  if (!ok.includes(String(confirm || "").trim().toLowerCase())) throw badRequest(`Pakka karne ke liye trust ka admin e-mail likhein: ${info.email || info.adminId}`);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM admins WHERE id = ${info.adminId} FOR UPDATE`);
    await tx.execute(sql`DELETE FROM accounts WHERE admin_id = ${info.adminId}`);
    await tx.execute(sql`DELETE FROM admins WHERE id = ${info.adminId}`); // programs, members, dues, transactions, agents… cascade
    await tx.execute(sql`UPDATE migration_jobs SET report = report || jsonb_build_object('reverted', true, 'revertedAt', now(), 'revertedCounts',
      ${JSON.stringify({ members: info.members, transactions: info.transactions, logins: info.logins })}::jsonb), logins_enc = NULL, updated_at = now() WHERE id = ${id}`);
  });
  clearFeatureCache();
  // copied photos / documents (local storage only; bucket files stay — harmless, not linked any more)
  let filesRemoved = false;
  if ((process.env.STORAGE || "local").toLowerCase() === "local" && /^[\w-]+$/.test(String(info.adminId))) {
    const { rm } = await import("node:fs/promises");
    const path = (await import("node:path")).default;
    const dir = path.resolve(process.env.UPLOAD_DIR || "./uploads", String(info.adminId), "migrated");
    await rm(dir, { recursive: true, force: true }).then(() => { filesRemoved = true; }).catch(() => {});
  }
  return { success: true, removed: { members: info.members, transactions: info.transactions, logins: info.logins }, filesRemoved };
}

export async function jobLoginsCsv(id) {
  const { rows: [r] } = await db.execute(sql`SELECT logins_enc, source_trust_name FROM migration_jobs WHERE id = ${id}`);
  if (!r?.logins_enc) throw notFound("Passwords file nahi hai (delete ho chuki ya bani hi nahi)");
  return { csv: decrypt(r.logins_enc), name: r.source_trust_name };
}
export async function dropLogins(id) {
  await db.execute(sql`UPDATE migration_jobs SET logins_enc = NULL, updated_at = now() WHERE id = ${id}`);
  return { success: true };
}
export function cancelJob(id) {
  const r = running.get(id);
  if (!r) throw badRequest("Ye job chal nahi raha");
  r.cancel = true;
  return { success: true };
}

/**
 * Start a run. body: { connectionId, trustId, mode: "new"|"replace", dryRun, copyFiles, adminEmail, adminPassword }
 */
export async function startJob(body, by = "control") {
  cleanup();
  const conn = connections.get(body.connectionId);
  if (!conn) throw badRequest("Firebase connection khatam ho gaya — key dobara daal kar \"Connect\" karein");
  conn.at = Date.now();
  const src = SOURCES[conn.kind];
  const trustId = String(body.trustId || "");
  if (!trustId) throw badRequest("Trust chunein");
  if ([...running.values()].some((x) => x.trustId === trustId)) throw badRequest("Is trust ka migration pehle se chal raha hai");
  const mode = body.mode === "replace" ? "replace" : "new";
  const dry = !!body.dryRun;
  const id = randomUUID();
  const row = {
    id, kind: conn.kind, source_project: conn.projectId, source_trust_id: trustId, source_trust_name: String(body.trustName || trustId).slice(0, 200),
    target_admin_id: null, mode, dry_run: dry, options: { copyFiles: body.copyFiles !== false, adminEmail: body.adminEmail || "" },
    status: "running", steps: newSteps(dry, body.copyFiles !== false), log: [], report: {}, error: "", finished_at: null,
  };
  await db.execute(sql`
    INSERT INTO migration_jobs (id, kind, source_project, source_trust_id, source_trust_name, mode, dry_run, options, status, steps, created_by)
    VALUES (${id}, ${row.kind}, ${row.source_project}, ${trustId}, ${row.source_trust_name}, ${mode}, ${dry}, ${JSON.stringify(row.options)}::jsonb,
            'running', ${JSON.stringify(row.steps)}::jsonb, ${by})`);
  const state = { cancel: false, trustId };
  running.set(id, state);
  const job = new Job(row);
  run(job, conn, src, body, state).finally(() => running.delete(id));
  return { jobId: id };
}

async function run(job, conn, src, body, state) {
  const r = job.row;
  const isCancelled = () => state.cancel;
  const fail = async (key, e) => {
    if (key) job.step(key, { status: "fail", note: String(e?.message || e).slice(0, 300) });
    r.status = state.cancel ? "cancelled" : "failed";
    const pg = e?.cause?.code || e?.code;
    const why = pg === "22003" ? `Number bahut bada (${e?.cause?.message || e.message}) — kisi rakam / ginti column mein galat value` : String(e?.cause?.message || e?.message || e);
    const safe = ["read", "check", "write"].includes(key) ? " · database mein kuch nahi likha gaya, sab pehle jaisa hai" : "";
    r.error = state.cancel ? "Aapne rok diya — database mein kuch nahi likha gaya (ya sirf files adhoori)" : (why + safe).slice(0, 500);
    r.finished_at = new Date().toISOString();
    job.log(r.error, "error");
    await job.flush(true);
  };
  let cur = "read";
  try {
    job.log(`${src.LABEL} · project ${conn.projectId} · trust ${r.source_trust_id}${r.dry_run ? " · sirf jaanch (dry run)" : ""}`);
    job.step("read", { status: "run" });
    const raw = conn.raw
      ? (() => { const t = conn.raw.get(r.source_trust_id); if (!t) throw new Error("Backup mein ye trust nahi"); job.step("read", { done: 1, total: 1, note: "JSON backup se" }); return t; })()
      : await src.read(conn.fsdb, conn.auth, r.source_trust_id, (_s, done, total, note) => { job.step("read", { done, total, note }); if (note) job.log(note); });
    if (isCancelled()) throw new Error("Rok diya gaya");
    job.step("read", { status: "done", note: "padh liya" });

    cur = "check";
    job.step("check", { status: "run", note: "mapping…" });
    const bundle = reconcile(fitted(src.build(raw, { adminEmail: body.adminEmail, adminPassword: body.adminPassword })));
    r.target_admin_id = bundle.admin.id;
    r.report = {
      counts: bundle.counts, money: bundle.money, reconcile: bundle.reconcile, skipped: bundle.skipped,
      warnings: bundle.warnings.slice(0, 1500), warningCount: bundle.warnings.length, adminEmail: bundle.admin.email, trustName: bundle.admin.display_name,
    };
    job.log(`${bundle.counts.members} members, ${bundle.counts.dues} dues, ${bundle.counts.transactions} transactions, ${bundle.counts.files} files · ${bundle.warnings.length} chetavani`);
    job.step("check", { status: "done", note: `${bundle.warnings.length} chetavani` });
    if (r.dry_run) {
      r.status = "done"; r.finished_at = new Date().toISOString();
      job.log("Dry run poora — database mein kuch nahi likha. Report dekh kar \"Asli migration\" chalayein.");
      await job.flush(true);
      return;
    }

    cur = "write";
    job.step("write", { status: "run" });
    const w = await writeBundle(bundle, { mode: r.mode, isCancelled, progress: (_s, done, total, note) => job.step("write", { done: Math.round(done), total, note }) });
    clearFeatureCache();
    r.report.skippedLogins = w.skippedLogins.slice(0, 2000);
    if (w.logins.length || w.skippedLogins.length) {
      const csv = "﻿role,loginId,password,name\n" + w.logins.map((l) => [l.role, l.loginId, l.password, `"${String(l.name || "").replace(/"/g, "'")}"`].join(",")).join("\n");
      await db.execute(sql`UPDATE migration_jobs SET logins_enc = ${encrypt(csv)} WHERE id = ${r.id}`);
    }
    job.log(`Database mein likh diya (commit) · ${w.logins.length} naye passwords · ${w.skippedLogins.length} login nahi bane`);
    job.step("write", { status: "done", note: "commit ✓" });

    cur = "files";
    if (r.options.copyFiles && bundle.files.length) {
      job.step("files", { status: "run" });
      const f = await copyFiles(bundle.admin.id, bundle.files, { storage: conn.storage, isCancelled, progress: (done, total, note) => job.step("files", { done, total, note }) });
      r.report.files = { total: f.total, copied: f.copied, failed: f.failed.length, failedList: f.failed.slice(0, 500) };
      job.log(`Files: ${f.copied}/${f.total} copy · ${f.failed.length} nahi hui (purana link rakha)`, f.failed.length ? "warn" : "info");
      job.step("files", { status: f.failed.length && !f.copied ? "fail" : "done", note: `${f.copied}/${f.total}` });
    } else job.step("files", { status: "skip", note: bundle.files.length ? "band" : "koi file nahi" });

    cur = "verify";
    job.step("verify", { status: "run" });
    const v = await verifyTrust(bundle.admin.id, bundle);
    r.report.verify = v;
    job.step("verify", { status: v.ok ? "done" : "fail", note: v.ok ? "sab sahi ✓" : "kuch farq — report dekhein" });
    r.status = "done"; r.finished_at = new Date().toISOString();
    job.log(v.ok ? "Migration poora ✓" : "Migration poora, par jaanch mein farq mila — report dekhein", v.ok ? "info" : "warn");
    await job.flush(true);
  } catch (e) {
    await fail(cur, e);
  } finally {
    if (!r.dry_run) { /* the key stays for another run until the connection expires */ }
  }
}

const fitted = (bundle) => { fitInts(bundle); return bundle; };

/** For tests / CLI: run the whole pipeline on an already-read raw object (no Firebase). */
export async function importRaw(kind, raw, { mode = "new", adminEmail, adminPassword, dryRun = false } = {}) {
  const src = SOURCES[kind];
  const bundle = reconcile(fitted(src.build(raw, { adminEmail, adminPassword })));
  if (dryRun) return { bundle };
  const w = await writeBundle(bundle, { mode });
  const verify = await verifyTrust(bundle.admin.id, bundle);
  return { bundle, ...w, verify };
}
