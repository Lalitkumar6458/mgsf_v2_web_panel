// Source 1: the old MGSF web panel (Firestore  users/{uid}/…). Same mapping rules as
// scripts/migrate-from-firestore.js (that script stays for command-line use), plus file copy.
//
//   users/{uid}                                → admins + admin login
//   users/{uid}/organizations|contact|policies → admins.trust_info / contact / policies
//   users/{uid}/agents                         → agents + agent login (old plaintext password is hashed)
//   users/{uid}/programs                       → programs
//   programs/{id}/closing_groups               → closing_groups
//   programs/{id}/members                      → members (+ member login = registration number)
//   programs/{id}/payment_pending              → dues
//   programs/{id}/transactions                 → transactions (delete_flag → reversed)
//   programs/{id}/joinFeesTransactions         → join_fee_payments
// Document ids are kept, so every old reference keeps working.
import { randomBytes } from "node:crypto";
import { defaultMemberPassword } from "../../lib/regNumber.js";
import { fmtISO } from "../../lib/dates.js";
import { s, n, b, day, ts, plain, without, json, isRemoteFile, makeReport, emptyBundle, countBundle } from "./common.js";

export const KIND = "mgsf";
export const LABEL = "Purana MGSF panel (users/{uid})";

const docs = async (ref) => (await ref.get()).docs.map((d) => ({ id: d.id, ...d.data() }));

/** Trusts in this Firebase project (every users/* doc that has programs), with rough counts. */
export async function listTrusts(fsdb) {
  const users = (await fsdb.collection("users").get()).docs;
  const out = [];
  for (const u of users) {
    const progs = await fsdb.collection(`users/${u.id}/programs`).get();
    if (progs.empty) continue;
    let members = 0;
    for (const p of progs.docs) {
      try { members += (await fsdb.collection(`users/${u.id}/programs/${p.id}/members`).count().get()).data().count; } catch { /* count() unsupported */ }
    }
    const org = await fsdb.doc(`users/${u.id}/organizations/trustInfo`).get().catch(() => null);
    const d = u.data() || {};
    out.push({
      id: u.id, name: s(org?.data()?.trustName || org?.data()?.name || d.displayName || d.name || d.email || u.id),
      email: s(d.email), programs: progs.size, members,
    });
  }
  return out;
}

/** Read everything of one trust. progress(step, done, total, note) */
export async function read(fsdb, auth, uid, progress = () => {}) {
  const uref = fsdb.doc(`users/${uid}`);
  const u = await uref.get();
  let authUser = null;
  try { authUser = await auth.getUser(uid); } catch { /* no auth user */ }
  const t = {
    id: uid, data: u.exists ? u.data() : {}, authEmail: authUser?.email || "",
    organizations: await docs(uref.collection("organizations")),
    contact: await docs(uref.collection("contact")),
    policies: await docs(uref.collection("policies")),
    agents: await docs(uref.collection("agents")),
    programs: [],
  };
  const programs = await docs(uref.collection("programs"));
  let i = 0;
  for (const p of programs) {
    progress("read", i, programs.length, `${p.name || p.id}: members…`);
    const pref = uref.collection("programs").doc(p.id);
    const entry = { ...p };
    entry._members = await docs(pref.collection("members"));
    progress("read", i, programs.length, `${p.name || p.id}: ${entry._members.length} members · payment_pending…`);
    entry._closing_groups = await docs(pref.collection("closing_groups"));
    entry._payment_pending = await docs(pref.collection("payment_pending"));
    progress("read", i, programs.length, `${p.name || p.id}: ${entry._payment_pending.length} dues · transactions…`);
    entry._transactions = await docs(pref.collection("transactions"));
    entry._join_fees = await docs(pref.collection("joinFeesTransactions"));
    t.programs.push(entry);
    i++;
    progress("read", i, programs.length, `${p.name || p.id}: ${entry._members.length} members, ${entry._payment_pending.length} dues, ${entry._transactions.length} transactions`);
  }
  return plain(t);
}

const MEMBER_KNOWN = ["displayName", "fatherName", "gender", "gotra", "jati", "guardian", "guardianRelation", "guardianAadharNo",
  "phone", "phoneNo", "phoneAlt", "aadhaarNo", "bobDate", "currentAddress", "village", "district", "state", "pinCode", "ageGroup",
  "ageGroupRange", "memberGroup", "locationGroup", "locactionGroupId", "closingMonths", "membershipClosingDate", "dateJoin",
  "payAmount", "joinFees", "joinFeesDone", "joinFeesTxtId", "joinFeesPaymentType", "joinFeesPaidAmount", "joinFeesRemainingAmount",
  "addedBy", "addedByName", "photoURL", "extraImageURL", "documentFrontURL", "documentBackURL", "guardianDocumentURL",
  "guardianDocumentBackURL", "extraDetails", "note", "registrationNumber", "applicationNumber", "memberNumber", "agentId", "status",
  "active_flag", "delete_flag", "isBlocked", "marriage_flag", "marriage_date", "closing_date", "closing_date_query",
  "closing_datetime", "closingAt", "closingGroupId", "closingGroupName", "closingNotes", "invitationCardURL", "pdfData",
  "createdAt", "updatedAt", "programId", "programName", "role", "password", "search_keywords", "id"];
export const MEMBER_FILE_COLUMNS = ["photo_url", "extra_image_url", "document_front_url", "document_back_url", "guardian_document_url", "guardian_document_back_url", "invitation_card_url"];
const STATUS_RANK = { paid: 3, partial: 2, pending: 1 };

function mapMember(m, programId, agentIds, groupIds, defaultPay, r) {
  let status = ["pending", "accepted", "rejected", "removed", "closed"].includes(m.status) ? m.status : "accepted";
  const blocked = m.status === "blocked" || b(m.isBlocked);
  if (m.status === "blocked") status = "accepted";
  if (!["pending", "accepted", "rejected", "removed", "closed", "blocked"].includes(m.status)) r.warn(`member ${m.id}: anjaan status "${m.status}" → accepted`);
  let closingDate = null;
  if (b(m.marriage_flag) || m.status === "closed") {
    closingDate = day(m.marriage_date) || day(m.closing_date) || day(m.closing_date_query) || day(m.closing_datetime);
    if (!closingDate) r.warn(`member ${m.id} (${s(m.displayName)}): vivah mark hai par tareekh nahi → closed nahi kiya`);
    else if (status === "accepted" || status === "closed") status = "closed";
  }
  if (!closingDate && status === "closed") status = "accepted";
  let dateJoin = day(m.dateJoin);
  if (!dateJoin) {
    dateJoin = day(m.createdAt) || fmtISO(new Date());
    r.warn(`member ${m.id} (${s(m.displayName)}): galat join date "${s(m.dateJoin)}" → ${dateJoin}`);
  }
  const agentId = m.agentId && agentIds.has(m.agentId) ? m.agentId : null;
  if (m.agentId && !agentId) r.warn(`member ${m.id}: agent ${m.agentId} nahi mila → bina agent`);
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
    date_join: dateJoin, pay_amount: (m.payAmount === undefined || m.payAmount === null || m.payAmount === "") ? defaultPay : n(m.payAmount, defaultPay),
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
    commission: "{}",
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

/**
 * Raw trust → bundle (rows ready to insert). opts: { adminEmail, adminPassword }
 * Passwords in bundle.accounts are PLAIN here; writer.js hashes them. generated: true → goes in the logins file.
 */
export function build(t, opts = {}) {
  const r = makeReport();
  const out = emptyBundle();
  const adminId = t.id;
  const byId = (arr) => Object.fromEntries(arr.map(({ id, ...d }) => [id, plain(d)]));
  const email = (s(opts.adminEmail) || s(t.data.email) || s(t.authEmail) || `${adminId}@trust.local`).toLowerCase();
  const orgs = byId(t.organizations);
  out.admin = {
    id: adminId, email, display_name: s(t.data.displayName || t.data.name || t.organizations.find((o) => o.id === "trustInfo")?.trustName),
    phone: s(t.data.phone), trust_info: JSON.stringify(orgs.trustInfo || orgs), contact: JSON.stringify(byId(t.contact)),
    policies: JSON.stringify(byId(t.policies)),
    extra: JSON.stringify({ ...without(t.data, ["email", "displayName", "phone", "password", "createdAt", "updatedAt"]), migratedFrom: "mgsf-firebase" }),
  };
  for (const k of ["logo", "RightLogo", "headerImg", "stampImg", "trustStamp", "banner"]) {
    const v = (orgs.trustInfo || {})[k];
    if (isRemoteFile(v)) out.files.push({ table: "admins", id: adminId, column: "trust_info", key: k, url: v });
  }
  out.accounts.push({ role: "admin", login_id: email, email, phone: out.admin.phone, display_name: out.admin.display_name,
    password: opts.adminPassword || randomBytes(6).toString("base64url"), generated: !opts.adminPassword, admin_id: adminId, agent_id: null, member_id: null, active: true });

  out.agents = t.agents.map((a) => mapAgent(a, adminId));
  const agentIds = new Set(out.agents.map((a) => a.id));
  for (const a of out.agents) {
    for (const col of ["photo_url", "signature_url"]) if (isRemoteFile(a[col])) out.files.push({ table: "agents", id: a.id, column: col, url: a[col] });
    JSON.parse(a.document_urls || "[]").forEach((u, i) => { if (isRemoteFile(typeof u === "string" ? u : u?.url)) out.files.push({ table: "agents", id: a.id, column: "document_urls", index: i, url: typeof u === "string" ? u : u.url }); });
  }
  for (const a of t.agents) {
    const loginId = s(a.email).toLowerCase();
    if (!loginId) { r.skip("agentLogin", `agent ${a.id} (${s(a.displayName)}): email nahi → login nahi bana`); continue; }
    const pwd = s(a.password);
    out.accounts.push({ role: "agent", login_id: loginId, email: loginId, phone: s(a.phone), display_name: s(a.displayName),
      password: pwd || randomBytes(5).toString("base64url"), generated: !pwd, admin_id: adminId, agent_id: a.id, member_id: null,
      active: b(a.active_flags ?? a.active_flag, true) && !b(a.delete_flags ?? a.delete_flag) });
  }

  for (const p of t.programs) {
    out.programs.push(mapProgram(p, adminId));
    for (const g of p._closing_groups) out.groups.push({ id: g.id, program_id: p.id, name: s(g.name) || "Group", created_at: ts(g.createdAt) || new Date() });
    const groupIds = new Set(p._closing_groups.map((g) => g.id));
    const memberMap = new Map();
    for (const m of p._members) {
      const row = mapMember(m, p.id, agentIds, groupIds, 200, r);
      out.members.push(row);
      memberMap.set(m.id, row);
      for (const col of MEMBER_FILE_COLUMNS) if (isRemoteFile(row[col])) out.files.push({ table: "members", id: row.id, column: col, url: row[col] });
      const regNo = row.registration_number.toLowerCase();
      if (row.status === "pending" || row.status === "rejected" || !regNo || row.deleted) continue;
      const pwd = s(m.password) || defaultMemberPassword(row.display_name, row.birth_date);
      out.accounts.push({ role: "member", login_id: regNo, email: null, phone: row.phone, display_name: row.display_name, password: pwd, generated: false,
        admin_id: adminId, agent_id: null, member_id: m.id, active: row.active && !row.blocked && row.status !== "removed" });
    }

    const duePairs = new Map();
    for (const d of p._payment_pending) {
      if (b(d.delete_flag)) { r.skip("deletedPaymentPending"); continue; }
      const closingId = d.closingMemberId || d.marriageId;
      const payerId = d.memberId;
      if (!memberMap.has(closingId) || !memberMap.has(payerId)) { r.skip("orphanPaymentPending", `payment_pending ${d.id}: member ${!memberMap.has(closingId) ? closingId : payerId} nahi mila → chhoda`); continue; }
      const status = ["paid", "partial"].includes(d.status) ? d.status : "pending";
      if (closingId === payerId && status === "pending") { r.skip("selfPaymentPending", `payment_pending ${d.id}: member apni hi closing ka (purana bug) → chhoda`); continue; }
      const payer = memberMap.get(payerId);
      const amount = (d.payAmount === undefined || d.payAmount === null || d.payAmount === "") ? payer.pay_amount : n(d.payAmount, payer.pay_amount);
      if (status === "pending" && amount <= 0) { r.skip("zeroPayAmountPending"); continue; }
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
        r.skip("duplicatePaymentPending", `ek hi closing × payer ke do payment_pending (${prev.id}, ${d.id})`);
        if (STATUS_RANK[status] <= STATUS_RANK[prev.status]) continue;
      }
      duePairs.set(key, row);
    }
    out.dues.push(...duePairs.values());
    const dueIds = new Set([...duePairs.values()].map((x) => x.id));

    const txNumbers = new Set();
    for (const x of p._transactions) {
      if (!memberMap.has(x.payerId)) { r.skip("orphanTransaction", `transaction ${x.id}: payer ${x.payerId} nahi mila → chhoda`); continue; }
      let num = s(x.transactionNumber) || `TRX-MIG-${x.id}`;
      if (txNumbers.has(num)) num = `${num}-${x.id.slice(0, 6)}`;
      txNumbers.add(num);
      const closingId = x.closingMemberId || x.marriageId;
      out.transactions.push({
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
      if (!memberMap.has(j.memberId)) { r.skip("orphanJoinFee", `joinFeesTransactions ${j.id}: member ${j.memberId} nahi mila → chhoda`); continue; }
      out.joinFees.push({
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

  out.money = {
    duesPaid: out.dues.filter((d) => d.status === "paid").length,
    duesOpen: out.dues.filter((d) => d.status !== "paid").length,
    collectedPerDues: out.dues.reduce((a, d) => a + d.paid_amount, 0),
    collectedPerTransactions: out.transactions.filter((x) => x.status === "completed" && x.transaction_type === "marriage_payment").reduce((a, x) => a + x.amount, 0),
    joinFees: out.joinFees.reduce((a, j) => a + j.amount, 0),
  };
  if (out.money.collectedPerDues !== out.money.collectedPerTransactions) {
    r.warn(`payment_pending mein jama (₹${out.money.collectedPerDues}) aur transactions ka jod (₹${out.money.collectedPerTransactions}) alag hai — ye farq purane data mein hi hai`);
  }
  out.warnings = r.warnings;
  out.skipped = r.skipped;
  out.counts = countBundle(out);
  out.source = { kind: KIND, id: adminId };
  return out;
}
