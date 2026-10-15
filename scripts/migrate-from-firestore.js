#!/usr/bin/env node
/**
 * One-time data move: Firestore (old MGSF) → PostgreSQL (MGSF v2).
 *
 * Usage (run on your own computer / server, NOT in the browser):
 *   1. Firebase console → Project settings → Service accounts → "Generate new private key"
 *      save it as  mgsf_v2/firebase-service-account.json   (never commit it)
 *   2. npm run db:migrate                         (creates the empty tables)
 *   3. node --env-file=.env scripts/migrate-from-firestore.js --dry-run     (read + check only)
 *   4. node --env-file=.env scripts/migrate-from-firestore.js               (real import)
 *
 * Options
 *   --dry-run                 read everything and print the report, write nothing
 *   --admin=<uid>             only this trust (users/{uid}); default: every users/* doc that has programs
 *   --fresh                   delete that trust's rows in Postgres first (to re-run the import)
 *   --admin-password=<pwd>    password for the admin login(s); default: a random one written to the logins CSV
 *   --export-json=<file>      also save everything read from Firestore into a JSON backup file
 *   --from-json=<file>        read from such a JSON file instead of Firestore (offline re-run / testing)
 *   --service-account=<file>  default ./firebase-service-account.json
 *
 * What is mapped
 *   users/{uid}                          → admins + admin login (accounts)
 *   users/{uid}/organizations|contact|policies → admins.trust_info / contact / policies (json)
 *   users/{uid}/agents                   → agents + agent login (old plaintext "password" field is hashed)
 *   users/{uid}/programs                 → programs
 *   programs/{id}/closing_groups            → closing_groups
 *   programs/{id}/members                   → members (+ member login, loginId = registration number)
 *        marriage_flag + marriage_date   → closing_date, status 'closed'
 *        status 'blocked' / isBlocked    → blocked = true
 *        delete_flag / active_flag       → deleted / active
 *        any other field                 → members.extra (nothing is lost)
 *   programs/{id}/payment_pending           → dues    (delete_flag=true rows are skipped)
 *   programs/{id}/transactions              → transactions (delete_flag=true → status 'reversed')
 *   programs/{id}/joinFeesTransactions      → join_fee_payments
 * Document ids are kept, so every old reference keeps working.
 * Uploaded files (photos, documents) keep their Firebase Storage URLs.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";
import { toDate, fmtISO } from "../src/lib/dates.js";
import { defaultMemberPassword } from "../src/lib/regNumber.js";

pg.types.setTypeParser(1082, (v) => v);

// ─── args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const DRY = !!args["dry-run"];
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const report = { startedAt: new Date().toISOString(), dryRun: DRY, trusts: [], warnings: [] };
const logins = []; // generated passwords → CSV
const warn = (msg) => { report.warnings.push(msg); if (report.warnings.length <= 50) console.warn("  ⚠", msg); };

// ─── value helpers ─────────────────────────────────────────────────────────
const isTs = (v) => v && typeof v === "object" && (typeof v.toDate === "function" || (typeof v._seconds === "number" && typeof v._nanoseconds === "number"));
const tsToDate = (v) => (typeof v.toDate === "function" ? v.toDate() : new Date(v._seconds * 1000));

/** Make Firestore data JSON-safe (Timestamps → ISO, refs → path, no \u0000). */
function plain(v) {
  if (v == null) return v ?? null;
  if (isTs(v)) return tsToDate(v).toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v.replace(/\u0000/g, "");
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") {
    if (typeof v.path === "string" && v.firestore) return v.path; // DocumentReference
    if (typeof v.latitude === "number" && typeof v.longitude === "number") return { lat: v.latitude, lng: v.longitude };
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = plain(x);
    return o;
  }
  return v;
}
const s = (v) => (v == null || v === "N/A" || v === "NA" ? "" : String(plain(v)).trim());
const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x) : d; };
const b = (v, d = false) => (v === undefined || v === null ? d : v === true || v === "true" || v === 1);
const day = (v) => (v == null || v === "" ? null : fmtISO(toDate(isTs(v) ? { toDate: () => tsToDate(v) } : v)) || null);
const ts = (v) => { if (!v) return null; if (isTs(v)) return tsToDate(v); const d = new Date(v); return isNaN(d) ? null : d; };
const without = (obj, keys) => { const o = { ...obj }; for (const k of keys) delete o[k]; return plain(o); };

// ─── source: Firestore or JSON file ────────────────────────────────────────
async function loadSource() {
  if (args["from-json"]) {
    console.log("Reading", args["from-json"]);
    return JSON.parse(fs.readFileSync(args["from-json"], "utf8"));
  }
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  const saPath = path.resolve(args["service-account"] || "./firebase-service-account.json");
  if (!fs.existsSync(saPath)) throw new Error(`Service account file not found: ${saPath}`);
  const app = initializeApp({ credential: cert(JSON.parse(fs.readFileSync(saPath, "utf8"))) });
  const fsdb = getFirestore(app);
  const auth = getAuth(app);

  const docs = async (ref) => (await ref.get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const users = args.admin ? [await fsdb.doc(`users/${args.admin}`).get()] : (await fsdb.collection("users").get()).docs;
  const out = { users: [] };
  for (const u of users) {
    const uref = fsdb.doc(`users/${u.id}`);
    const programs = await docs(uref.collection("programs"));
    if (!programs.length && !args.admin) continue; // not a trust (e.g. owner / old member docs)
    console.log(`Reading users/${u.id} (${programs.length} programs)…`);
    let authUser = null;
    try { authUser = await auth.getUser(u.id); } catch { /* no auth user */ }
    const t = {
      id: u.id,
      data: u.exists ? u.data() : {},
      authEmail: authUser?.email || "",
      organizations: await docs(uref.collection("organizations")),
      contact: await docs(uref.collection("contact")),
      policies: await docs(uref.collection("policies")),
      agents: await docs(uref.collection("agents")),
      programs: [],
    };
    for (const p of programs) {
      const pref = uref.collection("programs").doc(p.id);
      const entry = {
        ...p,
        _members: await docs(pref.collection("members")),
        _closing_groups: await docs(pref.collection("closing_groups")),
        _payment_pending: await docs(pref.collection("payment_pending")),
        _transactions: await docs(pref.collection("transactions")),
        _join_fees: await docs(pref.collection("joinFeesTransactions")),
      };
      console.log(`  ${p.name || p.id}: ${entry._members.length} members, ${entry._payment_pending.length} payment_pending, ${entry._transactions.length} transactions`);
      t.programs.push(entry);
    }
    out.users.push(t);
  }
  if (args["export-json"]) {
    fs.writeFileSync(args["export-json"], JSON.stringify(plain(out)));
    console.log("Saved JSON backup →", args["export-json"]);
  }
  return out;
}

// ─── mappers ───────────────────────────────────────────────────────────────
const MEMBER_KNOWN = ["displayName", "fatherName", "gender", "gotra", "jati", "guardian", "guardianRelation", "guardianAadharNo",
  "phone", "phoneNo", "phoneAlt", "aadhaarNo", "bobDate", "currentAddress", "village", "district", "state", "pinCode", "ageGroup",
  "ageGroupRange", "memberGroup", "locationGroup", "locactionGroupId", "closingMonths", "membershipClosingDate", "dateJoin",
  "payAmount", "joinFees", "joinFeesDone", "joinFeesTxtId", "joinFeesPaymentType", "joinFeesPaidAmount", "joinFeesRemainingAmount",
  "addedBy", "addedByName", "photoURL", "extraImageURL", "documentFrontURL", "documentBackURL", "guardianDocumentURL",
  "guardianDocumentBackURL", "extraDetails", "note", "registrationNumber", "applicationNumber", "memberNumber", "agentId", "status",
  "active_flag", "delete_flag", "isBlocked", "marriage_flag", "marriage_date", "closing_date", "closing_date_query",
  "closing_datetime", "closingAt", "closingGroupId", "closingGroupName", "closingNotes", "invitationCardURL", "pdfData",
  "createdAt", "updatedAt", "programId", "programName", "role", "password", "search_keywords", "id"];

function mapMember(m, programId, agentIds, groupIds, defaultPay) {
  let status = ["pending", "accepted", "rejected", "removed", "closed"].includes(m.status) ? m.status : "accepted";
  const blocked = m.status === "blocked" || b(m.isBlocked);
  if (m.status === "blocked") status = "accepted";
  if (!["pending", "accepted", "rejected", "removed", "closed", "blocked"].includes(m.status)) warn(`member ${m.id}: unknown status "${m.status}" → accepted`);

  let closingDate = null;
  if (b(m.marriage_flag) || m.status === "closed") {
    closingDate = day(m.marriage_date) || day(m.closing_date) || day(m.closing_date_query) || day(m.closing_datetime);
    if (!closingDate) warn(`member ${m.id} (${s(m.displayName)}): marked married but no valid marriage date → left as not closed`);
    else if (status === "accepted" || status === "closed") status = "closed";
  }
  if (!closingDate && status === "closed") status = "accepted";

  let dateJoin = day(m.dateJoin);
  if (!dateJoin) {
    dateJoin = day(m.createdAt) || fmtISO(new Date());
    warn(`member ${m.id} (${s(m.displayName)}): invalid dateJoin "${s(m.dateJoin)}" → ${dateJoin}`);
  }
  const agentId = m.agentId && agentIds.has(m.agentId) ? m.agentId : null;
  if (m.agentId && !agentId) warn(`member ${m.id}: agent ${m.agentId} not found → no agent`);
  const groupId = m.closingGroupId && groupIds.has(m.closingGroupId) ? m.closingGroupId : null;

  return {
    id: m.id, program_id: programId, agent_id: agentId,
    registration_number: s(m.registrationNumber), application_number: s(m.applicationNumber), member_number: n(m.memberNumber),
    status, active: b(m.active_flag, true) && !blocked, deleted: b(m.delete_flag), blocked,
    display_name: s(m.displayName), father_name: s(m.fatherName), gender: s(m.gender), gotra: s(m.gotra), jati: s(m.jati),
    guardian: s(m.guardian), guardian_relation: s(m.guardianRelation), guardian_aadhar_no: s(m.guardianAadharNo),
    phone: s(m.phone || m.phoneNo), phone_alt: s(m.phoneAlt), aadhaar_no: s(m.aadhaarNo), birth_date: day(m.bobDate),
    current_address: s(m.currentAddress), village: s(m.village), district: s(m.district), state: s(m.state), pin_code: s(m.pinCode),
    age_group: s(m.ageGroup), age_group_range: s(m.ageGroupRange), member_group: s(m.memberGroup), location_group: s(m.locationGroup),
    location_group_id: s(m.locactionGroupId), closing_months: n(m.closingMonths), membership_closing_date: day(m.membershipClosingDate),
    date_join: dateJoin, pay_amount: (m.payAmount === undefined || m.payAmount === null || m.payAmount === "") ? defaultPay : n(m.payAmount, defaultPay), // 0 stays 0 = pays nothing
    join_fees: n(m.joinFees), join_fees_done: b(m.joinFeesDone), join_fees_txn_id: s(m.joinFeesTxtId),
    join_fees_payment_type: s(m.joinFeesPaymentType), join_fees_paid_amount: n(m.joinFeesPaidAmount),
    join_fees_remaining_amount: n(m.joinFeesRemainingAmount),
    added_by: agentId ? "agent" : "admin", added_by_name: s(m.addedByName) || (agentId ? "" : "Admin"),
    photo_url: s(m.photoURL), extra_image_url: s(m.extraImageURL), document_front_url: s(m.documentFrontURL),
    document_back_url: s(m.documentBackURL), guardian_document_url: s(m.guardianDocumentURL),
    guardian_document_back_url: s(m.guardianDocumentBackURL),
    extra_details: JSON.stringify(Array.isArray(m.extraDetails) ? plain(m.extraDetails) : []), note: s(m.note),
    closing_date: closingDate, closing_at: closingDate ? ts(m.closingAt) || ts(m.closing_datetime) : null,
    closing_group_id: closingDate ? groupId : null, closing_notes: s(m.closingNotes), invitation_card_url: s(m.invitationCardURL),
    pdf_data: m.pdfData ? JSON.stringify(plain(m.pdfData)) : null,
    extra: JSON.stringify(without(m, MEMBER_KNOWN)),
    created_at: ts(m.createdAt) || new Date(), updated_at: ts(m.updatedAt) || ts(m.createdAt) || new Date(),
  };
}

function mapAgent(a, adminId) {
  return {
    id: a.id, admin_id: adminId, display_name: s(a.displayName) || "Agent", agent_code: s(a.agentCode),
    email: s(a.email).toLowerCase(), phone: s(a.phone), address: s(a.address), city: s(a.city), state: s(a.state),
    pin_code: s(a.pinCode), photo_url: s(a.photoURL), signature_url: s(a.signatureURL),
    document_urls: JSON.stringify(plain(a.documentURLs || a.documentUrls || [])), date_join: day(a.dateJoin),
    status: s(a.status) || "active", active: b(a.active_flags ?? a.active_flag, true), deleted: b(a.delete_flags ?? a.delete_flag),
    extra: JSON.stringify(without(a, ["displayName", "agentCode", "email", "phone", "address", "city", "state", "pinCode", "photoURL",
      "signatureURL", "documentURLs", "dateJoin", "status", "active_flags", "active_flag", "delete_flags", "delete_flag", "password",
      "firbaseToken", "programCounts", "createdAt", "updatedAt", "id"])),
    created_at: ts(a.createdAt) || new Date(),
  };
}

function mapProgram(p, adminId) {
  return {
    id: p.id, admin_id: adminId, name: s(p.name) || "Program", hiname: s(p.hiname), guname: s(p.guname), note_line: s(p.noteLine),
    about: s(p.about), category: typeof p.category === "string" ? p.category : "", is_selected: b(p.isSelected),
    age_groups: JSON.stringify(plain(p.ageGroups || [])), location_groups: JSON.stringify(plain(p.locationGroups || [])),
    reg_prefix: p.regPrefix ?? "R", reg_mode: p.regMode === "series" ? "series" : "random", reg_digits: n(p.regDigits, 6) || 6,
    reg_start_no: n(p.regStartNo, 1) || 1, reg_counter: n(p.regCounter), member_counter: n(p.memberCount),
    extra: JSON.stringify(without(p, ["name", "hiname", "guname", "noteLine", "about", "isSelected", "ageGroups", "locationGroups",
      "regPrefix", "regMode", "regDigits", "regStartNo", "regCounter", "memberCount", "createdAt", "updatedAt", "id",
      ...(typeof p.category === "string" ? ["category"] : [])].concat(Object.keys(p).filter((k) => k.startsWith("_"))))),
    created_at: ts(p.createdAt) || new Date(),
  };
}

const STATUS_RANK = { paid: 3, partial: 2, pending: 1 };

// ─── insert helper ─────────────────────────────────────────────────────────
async function insertRows(client, table, rows, chunk = 400) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values = [];
    const tuples = part.map((r, ri) => `(${cols.map((c, ci) => { values.push(r[c]); return `$${ri * cols.length + ci + 1}`; }).join(",")})`);
    await client.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")}`, values);
  }
  return rows.length;
}

// ─── import one trust ──────────────────────────────────────────────────────
async function importTrust(client, t) {
  const adminId = t.id;
  const email = (s(t.data.email) || s(t.authEmail) || `${adminId}@trust.local`).toLowerCase();
  const r = { adminId, email, counts: {}, skipped: {} };
  const skip = (k, msg) => { r.skipped[k] = (r.skipped[k] || 0) + 1; if (msg) warn(msg); };
  const byId = (arr) => Object.fromEntries(arr.map(({ id, ...d }) => [id, plain(d)]));

  // trust + admin login
  const admin = {
    id: adminId, email, display_name: s(t.data.displayName || t.data.name || t.organizations.find((o) => o.id === "trustInfo")?.trustName),
    phone: s(t.data.phone), trust_info: JSON.stringify(byId(t.organizations).trustInfo || byId(t.organizations)),
    contact: JSON.stringify(byId(t.contact)), policies: JSON.stringify(byId(t.policies)),
    extra: JSON.stringify(without(t.data, ["email", "displayName", "phone", "password", "createdAt", "updatedAt"])),
  };
  const adminPwd = args["admin-password"] || randomBytes(6).toString("base64url");
  if (!args["admin-password"]) logins.push({ role: "admin", loginId: email, password: adminPwd, name: admin.display_name });
  const accounts = [{
    id: randomUUID(), role: "admin", login_id: email, email, phone: admin.phone, display_name: admin.display_name,
    password_hash: await bcrypt.hash(adminPwd, 10), admin_id: adminId, agent_id: null, member_id: null, active: true,
  }];
  const usedLogins = new Set([email]);
  if (client) { // logins of OTHER trusts already in Postgres
    const { rows } = await client.query("SELECT login_id FROM accounts WHERE admin_id IS DISTINCT FROM $1", [adminId]);
    for (const x of rows) usedLogins.add(x.login_id);
    if (rows.some((x) => x.login_id === email)) throw new Error(`Login ${email} already belongs to another account`);
  }

  // agents
  const agents = t.agents.map((a) => mapAgent(a, adminId));
  const agentIds = new Set(agents.map((a) => a.id));
  for (const a of t.agents) {
    const loginId = s(a.email).toLowerCase();
    if (!loginId) { skip("agentLogin", `agent ${a.id} (${s(a.displayName)}): no email → no login created`); continue; }
    if (usedLogins.has(loginId)) { skip("agentLogin", `agent ${a.id}: email ${loginId} already used → no login`); continue; }
    usedLogins.add(loginId);
    let pwd = s(a.password);
    if (!pwd) { pwd = randomBytes(5).toString("base64url"); logins.push({ role: "agent", loginId, password: pwd, name: s(a.displayName) }); }
    accounts.push({
      id: randomUUID(), role: "agent", login_id: loginId, email: loginId, phone: s(a.phone), display_name: s(a.displayName),
      password_hash: await bcrypt.hash(pwd, 8), admin_id: adminId, agent_id: a.id, member_id: null,
      active: b(a.active_flags ?? a.active_flag, true) && !b(a.delete_flags ?? a.delete_flag),
    });
  }

  const programs = [], groups = [], members = [], dues = [], txs = [], joinFees = [];
  for (const p of t.programs) {
    const prog = mapProgram(p, adminId);
    programs.push(prog);
    const defaultPay = 200;
    for (const g of p._closing_groups) groups.push({ id: g.id, program_id: p.id, name: s(g.name) || "Group", created_at: ts(g.createdAt) || new Date() });
    const groupIds = new Set(p._closing_groups.map((g) => g.id));

    const memberMap = new Map();
    for (const m of p._members) {
      const row = mapMember(m, p.id, agentIds, groupIds, defaultPay);
      members.push(row);
      memberMap.set(m.id, row);
      // member login
      const regNo = row.registration_number.toLowerCase();
      if (row.status === "pending" || row.status === "rejected" || !regNo || row.deleted) continue;
      if (usedLogins.has(regNo)) { skip("memberLogin", `member ${m.id}: registration number ${row.registration_number} used twice → no login for this one`); continue; }
      usedLogins.add(regNo);
      const pwd = s(m.password) || defaultMemberPassword(row.display_name, row.birth_date);
      accounts.push({
        id: randomUUID(), role: "member", login_id: regNo, email: null, phone: row.phone, display_name: row.display_name,
        password_hash: await bcrypt.hash(pwd, 8), admin_id: adminId, agent_id: null, member_id: m.id,
        active: row.active && !row.blocked && row.status !== "removed",
      });
    }

    // payment_pending → dues (one row per closing × payer; best status wins on duplicates)
    const duePairs = new Map();
    for (const d of p._payment_pending) {
      if (b(d.delete_flag)) { skip("deletedPaymentPending"); continue; }
      const closingId = d.closingMemberId || d.marriageId;
      const payerId = d.memberId;
      if (!memberMap.has(closingId) || !memberMap.has(payerId)) { skip("orphanPaymentPending", `payment_pending ${d.id}: member ${!memberMap.has(closingId) ? closingId : payerId} not found → skipped`); continue; }
      const status = ["paid", "partial"].includes(d.status) ? d.status : "pending";
      if (closingId === payerId && status === "pending") { skip("selfPaymentPending", `payment_pending ${d.id}: member owes his own closing (old bug) → skipped`); continue; }
      const amount = (d.payAmount === undefined || d.payAmount === null || d.payAmount === "") ? memberMap.get(payerId).pay_amount : n(d.payAmount, memberMap.get(payerId).pay_amount);
      if (status === "pending" && amount <= 0) { skip("zeroPayAmountPending", `payment_pending ${d.id}: payer's pay amount is 0 → nothing to pay, skipped`); continue; }
      const paid = status === "paid" ? Math.max(n(d.paidAmount, amount), amount) : status === "partial" ? Math.min(n(d.paidAmount), amount) : 0;
      const row = {
        id: d.id, program_id: p.id, closing_member_id: closingId, payer_member_id: payerId,
        amount: Math.max(amount, paid), paid_amount: paid, status, due_date: day(d.dueDate), added_manually: b(d.addedManually),
        paid_at: status === "pending" ? null : ts(d.paymentDate) || ts(d.updatedAt), payment_method: s(d.paymentMethod),
        online_reference: s(d.onlineReference), created_at: ts(d.createdAt) || new Date(), updated_at: ts(d.updatedAt) || new Date(),
      };
      const key = `${closingId}|${payerId}`;
      const prev = duePairs.get(key);
      if (prev) {
        skip("duplicatePaymentPending", `duplicate payment_pending for closing ${closingId} × payer ${payerId} (${prev.id}, ${d.id}) → kept the ${STATUS_RANK[status] > STATUS_RANK[prev.status] ? "newer" : "first"}`);
        if (STATUS_RANK[status] <= STATUS_RANK[prev.status]) continue;
      }
      duePairs.set(key, row);
    }
    dues.push(...duePairs.values());
    const dueIds = new Set([...duePairs.values()].map((x) => x.id));

    const txNumbers = new Set();
    for (const x of p._transactions) {
      if (!memberMap.has(x.payerId)) { skip("orphanTransaction", `transaction ${x.id}: payer ${x.payerId} not found → skipped`); continue; }
      let num = s(x.transactionNumber) || `TRX-MIG-${x.id}`;
      if (txNumbers.has(num)) num = `${num}-${x.id.slice(0, 6)}`;
      txNumbers.add(num);
      const closingId = x.closingMemberId || x.marriageId;
      txs.push({
        id: x.id, program_id: p.id, transaction_number: num, batch_id: s(x.batchId) || `MIG-${x.id}`, sequence_number: n(x.sequenceNumber, 1),
        payer_member_id: x.payerId, closing_member_id: memberMap.has(closingId) ? closingId : null,
        due_id: dueIds.has(x.paymentPendingId) ? x.paymentPendingId : null, amount: n(x.amount),
        is_full_payment: b(x.isFullPayment, true), payment_method: s(x.paymentMethod) || "cash",
        payment_date: day(x.paymentDate) || day(x.createdAt) || fmtISO(new Date()), note: s(x.note),
        online_reference: s(x.onlineReference), online_verified: b(x.onlineVerified),
        transaction_type: s(x.transactionType) || "marriage_payment", bulk_payment_mode: s(x.bulkPaymentMode),
        status: b(x.delete_flag) || x.status === "deleted" ? "reversed" : "completed", created_by_id: s(x.createdBy),
        extra: JSON.stringify(without(x, ["amount", "paymentMethod", "paymentDate", "note", "status", "createdAt", "updatedAt", "programId",
          "programName", "payerId", "payerName", "payerFatherName", "payerRegistrationNumber", "payerPhone", "payerPhoto", "marriageId",
          "closingMemberId", "closingMemberName", "marriageMemberName", "closingMemberFatherName", "closingMemberRegistrationNumber",
          "marriageRegistrationNumber", "closingMemberPhoto", "marriageDate", "paymentPendingId", "isFullPayment", "createdBy",
          "active_flag", "delete_flag", "transactionType", "transactionNumber", "batchId", "sequenceNumber", "bulkPaymentMode",
          "search_keywords", "onlineReference", "onlineVerified", "id"])),
        created_at: ts(x.createdAt) || new Date(),
      });
    }

    for (const j of p._join_fees || []) {
      if (!memberMap.has(j.memberId)) { skip("orphanJoinFee", `joinFeesTransactions ${j.id}: member ${j.memberId} not found → skipped`); continue; }
      joinFees.push({
        id: j.id, program_id: p.id, member_id: j.memberId, amount: n(j.amount),
        payment_mode: s(j.paymentMode) || "cash", transaction_ref: s(j.transactionId),
        payment_date: day(j.paymentDate) || day(j.createdAt) || fmtISO(new Date()), note: s(j.note),
        agent_id: agentIds.has(j.agentId) ? j.agentId : null, created_by_id: s(j.createdBy), created_by_name: s(j.createdByName),
        extra: JSON.stringify(without(j, ["memberId", "memberName", "registrationNumber", "amount", "paymentMode", "transactionId",
          "note", "paymentDate", "createdAt", "createdBy", "agentId", "createdByName", "id"])),
        created_at: ts(j.createdAt) || new Date(),
      });
    }
  }

  r.counts = { joinFeePayments: joinFees.length, programs: programs.length, agents: agents.length, closingGroups: groups.length, members: members.length,
    dues: dues.length, transactions: txs.length, logins: accounts.length };
  r.money = {
    duesPaid: dues.filter((d) => d.status === "paid").length,
    duesOpen: dues.filter((d) => d.status !== "paid").length,
    collectedPerDues: dues.reduce((a, d) => a + d.paid_amount, 0),
    collectedPerTransactions: txs.filter((x) => x.status === "completed" && x.transaction_type === "marriage_payment").reduce((a, x) => a + x.amount, 0),
  };
  if (r.money.collectedPerDues !== r.money.collectedPerTransactions) {
    warn(`trust ${adminId}: paid amount in payment_pending (₹${r.money.collectedPerDues}) ≠ sum of transactions (₹${r.money.collectedPerTransactions}) — this difference already exists in the old data`);
  }
  if (DRY) return r;

  await client.query("BEGIN");
  try {
    if (args.fresh) await client.query("DELETE FROM admins WHERE id = $1", [adminId]);
    await client.query("DELETE FROM accounts WHERE admin_id = $1", [adminId]);
    await insertRows(client, "admins", [admin]);
    await insertRows(client, "agents", agents);
    await insertRows(client, "programs", programs);
    await insertRows(client, "closing_groups", groups);
    await insertRows(client, "members", members);
    await insertRows(client, "dues", dues);
    await insertRows(client, "transactions", txs);
    await insertRows(client, "join_fee_payments", joinFees);
    await insertRows(client, "accounts", accounts);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505" && /admins_pkey/.test(e.constraint || e.detail || "")) throw new Error(`Trust ${adminId} is already imported. Add --fresh to replace it.`);
    throw e;
  }
  return r;
}

// ─── main ──────────────────────────────────────────────────────────────────
const src = await loadSource();
const client = DRY ? null : new pg.Client({ connectionString: process.env.DATABASE_URL });
if (client) await client.connect();
try {
  for (const t of src.users) {
    if (args.admin && t.id !== args.admin) continue;
    console.log(`\n▶ Trust ${t.id}`);
    const r = await importTrust(client, t);
    report.trusts.push(r);
    console.log("  counts :", r.counts);
    console.log("  money  :", r.money);
    if (Object.keys(r.skipped).length) console.log("  skipped:", r.skipped);
  }
} finally {
  if (client) await client.end();
}

report.finishedAt = new Date().toISOString();
const outDir = path.resolve("migration-output");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `report-${stamp}.json`), JSON.stringify(report, null, 2));
if (logins.length && !DRY) {
  const csv = "role,loginId,password,name\n" + logins.map((l) => [l.role, l.loginId, l.password, `"${(l.name || "").replace(/"/g, "'")}"`].join(",")).join("\n");
  fs.writeFileSync(path.join(outDir, `new-logins-${stamp}.csv`), csv);
  console.log(`\n🔑 ${logins.length} logins got a new password → migration-output/new-logins-${stamp}.csv (share privately, then delete the file)`);
}
console.log(`\n${DRY ? "DRY RUN — nothing written." : "✔ Import finished."} ${report.warnings.length} warnings. Report → migration-output/report-${stamp}.json`);
