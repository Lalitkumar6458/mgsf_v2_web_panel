// Source 2: new-trust-project (Firestore  trusts/{trustId}/…). A different model:
//   • dues are NOT stored there — each member carries a ledger (paidUpTo, paidSeqs, exemptSeqs, partialPaid)
//     and every closing has an immutable `seq`. We rebuild one due per (payer × closing) with THEIR rule
//     (isEligible + amountFor, copied below), mark it paid / partial from the ledger…
//   • …and money comes from `payments` (one receipt = many closings + joining fee). Each receipt item becomes a
//     transaction; the joining fee part becomes a join_fee_payments row. Ledger and receipts are reconciled in
//     reconcile.js (money is never lost: a ledger-only "paid" gets a migration transaction, and is reported).
//   • commission_entries / commission_payouts → agent_commissions / agent_commission_payouts.
//
//   trusts/{t}                      → admins (branding → trust_info)
//   trusts/{t}/users                → admin login (owner / first admin)
//   trusts/{t}/agents               → agents (+ login: email, new password)
//   trusts/{t}/programs/{p}         → programs (ageGroups, registration, commissionPolicy)
//   …/closing_batches               → closing_groups (क्लोजिंग समूह)
//   …/closing_groups (यूनिट / rate card) → members.member_group
//   trusts/{t}/members              → members (+ login: reg. no., password = mobile number like there)
//   …/closings                      → the closed member's closing date / group / card
//   …/payments                      → transactions + join_fee_payments
//   trusts/{t}/member_requests (pending) → pending members (agent requests waiting for the office)
import { randomBytes } from "node:crypto";
import { fmtISO } from "../../lib/dates.js";
import { s, n, b, day, ts, plain, without, json, msDay, isRemoteFile, makeReport, emptyBundle, countBundle } from "./common.js";
import { MEMBER_FILE_COLUMNS } from "./sourceMgsf.js";

export const KIND = "trustNew";
export const LABEL = "Naya trust project (trusts/{trustId})";

const docs = async (ref) => (await ref.get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const sub = async (fsdb, path) => { try { return await docs(fsdb.collection(path)); } catch { return []; } };

export async function listTrusts(fsdb) {
  const trusts = (await fsdb.collection("trusts").get()).docs;
  const out = [];
  for (const t of trusts) {
    const d = t.data() || {};
    let members = 0;
    try { members = (await fsdb.collection(`trusts/${t.id}/members`).count().get()).data().count; } catch { /* */ }
    const progs = await fsdb.collection(`trusts/${t.id}/programs`).get();
    out.push({ id: t.id, name: s(d.branding?.nameHi || d.branding?.nameEn || d.name || t.id), email: s(d.branding?.email || d.email), programs: progs.size, members });
  }
  return out;
}

export async function read(fsdb, auth, trustId, progress = () => {}) {
  const base = `trusts/${trustId}`;
  const tdoc = await fsdb.doc(base).get();
  if (!tdoc.exists) throw new Error(`trusts/${trustId} nahi mila`);
  progress("read", 0, 1, "trust, users, agents…");
  const t = {
    id: trustId, data: tdoc.data() || {},
    users: await sub(fsdb, `${base}/users`),
    agents: await sub(fsdb, `${base}/agents`),
    members: [], requests: [], programs: [],
  };
  // login e-mails of staff (users docs may not carry them)
  for (const u of t.users) {
    if (u.email) continue;
    try { u.email = (await auth.getUser(u.id)).email || ""; } catch { /* */ }
  }
  progress("read", 0, 1, "members…");
  t.members = await sub(fsdb, `${base}/members`);
  t.requests = (await sub(fsdb, `${base}/member_requests`)).filter((x) => !x.status || x.status === "pending");
  const programs = await sub(fsdb, `${base}/programs`);
  let i = 0;
  for (const p of programs) {
    const pb = `${base}/programs/${p.id}`;
    progress("read", i, programs.length, `${p.name || p.id}: closings, payments…`);
    const entry = {
      ...p,
      _closings: await sub(fsdb, `${pb}/closings`),
      _payments: await sub(fsdb, `${pb}/payments`),
      _units: await sub(fsdb, `${pb}/closing_groups`),
      _batches: await sub(fsdb, `${pb}/closing_batches`),
      _commissionEntries: await sub(fsdb, `${pb}/commission_entries`),
      _payouts: await sub(fsdb, `${pb}/commission_payouts`),
      _counters: Object.fromEntries((await sub(fsdb, `${pb}/counters`)).map((c) => [c.id, c])),
    };
    t.programs.push(entry);
    i++;
    progress("read", i, programs.length, `${p.name || p.id}: ${entry._closings.length} closings, ${entry._payments.length} receipts, ${entry._commissionEntries.length} commission`);
  }
  return plain(t);
}

/* ── their rules (server/domain/ledger.js) ─────────────────────────────── */
function isEligible(member, closing) {
  if (!member || !closing) return false;
  if (closing.status && closing.status !== "active") return false;
  if (!Number.isFinite(closing.dateMs)) return false;
  if (member.delete_flag || member.status === "pending") return false;
  if (member.joinDateMs == null || !Number.isFinite(Number(member.joinDateMs))) return false;
  if (Number(member.joinDateMs) > closing.dateMs) return false;
  if (member.id && closing.memberId && member.id === closing.memberId) return false;
  if (closing.includeBlocked === false && member.status === "blocked") return false;
  const exitMs = member.closingDateMs ?? member.exitDateMs;
  if (member.status === "closed" && exitMs == null) return false;
  if (exitMs != null && Number.isFinite(Number(exitMs))) {
    const isClosing = member.status === "closed" || member.exitReason === "closed" || member.closingDateMs != null;
    if (isClosing ? Number(exitMs) < closing.dateMs : Number(exitMs) <= closing.dateMs) return false;
  }
  return true;
}
function amountFor(member, closing) {
  const o = Number(closing?.amountOverride); if (Number.isFinite(o) && o > 0) return Math.round(o);
  const m = Number(member?.payAmount); if (Number.isFinite(m) && m > 0) return Math.round(m);
  const c = Number(closing?.amount ?? closing?.amountPerMember); if (Number.isFinite(c) && c > 0) return Math.round(c);
  return 200;
}
const ints = (a) => (Array.isArray(a) ? a.map(Number).filter((x) => Number.isFinite(x) && x > 0).map(Math.trunc) : []);
function feePaid(m) {
  const total = Number(m.joinFees) || 0;
  if (m.joinFeesPaid === undefined || m.joinFeesPaid === null) return m.joinFeesDone ? total : 0;
  return Number(m.joinFeesPaid) || 0;
}
const METHOD = { cash: "cash", online: "online", upi: "upi", cheque: "cheque", bank: "bank", neft: "bank", imps: "bank" };
const msOf = (dateStr, ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? Number(ms) : (day(dateStr) ? Date.parse(`${day(dateStr)}T00:00:00+05:30`) : null));

/** their commission policy → our agents.commission config */
function commissionConfig(policy = {}, override = {}, r, agentName) {
  const pick = (k) => ({ ...(policy?.[k] || {}), ...(override?.[k] || {}) });
  const conv = (rule, name) => {
    if (!rule || rule.enabled === false) return { enabled: false, type: "percentage", value: 0 };
    let value = Number(rule.value) || 0;
    if (rule.mode === "slab") {
      value = Number(rule.slabs?.[0]?.value) || value;
      r.warn(`agent ${agentName}: ${name} commission "slab" tha — yahan pehli slab ki dar (${value}) lagi, chahein to badal lein`);
    }
    return { enabled: value > 0, type: rule.mode === "percent" || rule.mode === "slab" ? "percentage" : "fixed", value };
  };
  const joinFees = conv(pick("joinFee"), "join fee");
  const closing = conv(pick("collection"), "collection");
  return { enabled: joinFees.enabled || closing.enabled, joinFees, closing };
}

export function build(t, opts = {}) {
  const r = makeReport();
  const out = emptyBundle();
  const adminId = t.id;
  const br = t.data.branding || {};
  const owner = t.users.find((u) => ["owner", "admin", "superAdmin"].includes(u.role) && u.email) || t.users.find((u) => u.email);
  const email = (s(opts.adminEmail) || s(owner?.email) || s(br.email) || `${adminId}@trust.local`).toLowerCase();
  const phones = Array.isArray(br.phone) ? br.phone.filter(Boolean).join(" / ") : s(br.phone);
  const trustInfo = {
    name: s(br.nameHi || br.nameEn || t.data.name), shortName: s(br.shortName || br.nameEn),
    address: s(br.addressHi || br.addressEn), cityState: [br.city, br.district, br.state].filter(Boolean).join(", "),
    contact: phones, email: s(br.email), website: s(br.website), regNo: s(br.registrationNo), govtRegNo: s(br.panNo),
    signatoryName: s(br.signatoryName), founder: s(br.founder), about: s(br.tagline),
    logo: s(br.logoURL) || null, stampImg: s(br.sealURL) || null, RightLogo: s(br.deityImageURL || br.logoURL) || null,
  };
  out.admin = {
    id: adminId, email, display_name: trustInfo.name || s(owner?.displayName) || adminId, phone: s(Array.isArray(br.phone) ? br.phone[0] : br.phone),
    trust_info: JSON.stringify(trustInfo), contact: "{}", policies: "{}",
    extra: JSON.stringify({ migratedFrom: "trust-new-project", branding: plain(br), receiptPrefix: br.receiptPrefix || null }),
  };
  for (const k of ["logo", "stampImg", "RightLogo"]) if (isRemoteFile(trustInfo[k])) out.files.push({ table: "admins", id: adminId, column: "trust_info", key: k, url: trustInfo[k] });
  out.accounts.push({ role: "admin", login_id: email, email, phone: out.admin.phone, display_name: out.admin.display_name,
    password: opts.adminPassword || randomBytes(6).toString("base64url"), generated: !opts.adminPassword, admin_id: adminId, agent_id: null, member_id: null, active: true });

  // agents (commission rule from the first programme's policy + the agent's own override)
  const firstPolicy = t.programs[0]?.commissionPolicy || {};
  for (const a of t.agents) {
    const row = {
      id: a.id, admin_id: adminId, display_name: s(a.displayName) || "Agent", agent_code: s(a.agentCode || a.code),
      email: s(a.email).toLowerCase(), phone: s(a.phone), address: s(a.address), city: s(a.city || a.village), state: s(a.state),
      pin_code: s(a.pinCode), photo_url: s(a.photoURL), signature_url: s(a.signatureURL), document_urls: JSON.stringify(plain(a.documentURLs || [])),
      date_join: day(a.joinDate) || msDay(a.joinDateMs) || day(a.createdAt), status: b(a.delete_flag) ? "inactive" : s(a.status) || "active",
      active: b(a.active_flag ?? a.active, true) && !b(a.delete_flag), deleted: b(a.delete_flag),
      commission: JSON.stringify(commissionConfig(firstPolicy, a.commissionOverride, r, s(a.displayName))),
      extra: JSON.stringify(without(a, ["displayName", "agentCode", "code", "email", "phone", "address", "city", "state", "pinCode", "photoURL",
        "signatureURL", "documentURLs", "joinDate", "joinDateMs", "status", "active_flag", "active", "delete_flag", "commissionOverride", "id"])),
      created_at: ts(a.createdAt) || new Date(),
    };
    out.agents.push(row);
    for (const col of ["photo_url", "signature_url"]) if (isRemoteFile(row[col])) out.files.push({ table: "agents", id: row.id, column: col, url: row[col] });
    if (row.email) {
      out.accounts.push({ role: "agent", login_id: row.email, email: row.email, phone: row.phone, display_name: row.display_name,
        password: randomBytes(5).toString("base64url"), generated: true, admin_id: adminId, agent_id: row.id, member_id: null, active: row.active });
    } else r.skip("agentLogin", `agent ${row.display_name}: email nahi → login nahi bana`);
  }
  const agentIds = new Set(out.agents.map((a) => a.id));

  // members by programme
  const membersByProgram = new Map();
  for (const m of t.members) {
    if (!membersByProgram.has(m.programId)) membersByProgram.set(m.programId, []);
    membersByProgram.get(m.programId).push(m);
  }
  const programIds = new Set(t.programs.map((p) => p.id));
  for (const [pid, list] of membersByProgram) if (!programIds.has(pid)) r.skip("memberNoProgram", `${list.length} members ki yojna (${pid}) nahi mili → chhode`);

  const txIds = new Map(); // receiptId → [transaction ids]  (for commission)
  const feeIds = new Map(); // receiptId → join fee payment id

  for (const p of t.programs) {
    const reg = p.registration || {};
    const ageGroups = (p.ageGroups || []).map((g) => ({ id: g.id, startAge: n(g.startAge), endAge: n(g.endAge), payAmount: n(g.payAmount), joinFees: n(g.joinFee ?? g.joinFees) }));
    const defaultPay = n(ageGroups.find((g) => g.payAmount > 0)?.payAmount, 200) || 200;
    out.programs.push({
      id: p.id, admin_id: adminId, name: s(p.name) || "Program", hiname: s(p.hiname), guname: "", note_line: s(p.noteLine), about: s(p.about),
      category: typeof p.category === "string" ? p.category : "", is_selected: b(p.isSelected),
      age_groups: JSON.stringify(ageGroups), location_groups: JSON.stringify(plain(p.locationGroups || [])),
      reg_prefix: s(reg.prefix), reg_mode: reg.mode === "random" ? "random" : "series", reg_digits: n(reg.padding) || n(reg.randomLength) || 4,
      reg_start_no: n(reg.startFrom, 1) || 1, reg_counter: n(p._counters?.seq?.registration), member_counter: 0, default_pay_amount: defaultPay,
      extra: JSON.stringify({ ...without(p, ["name", "hiname", "noteLine", "about", "isSelected", "ageGroups", "locationGroups", "category",
        "createdAt", "updatedAt", "id", ...Object.keys(p).filter((k) => k.startsWith("_"))]), migratedFrom: "trust-new-project" }),
      created_at: ts(p.createdAt) || new Date(),
    });
    for (const g of p._batches) out.groups.push({ id: g.id, program_id: p.id, name: s(g.name || g.batchName || g.title) || "Group", created_at: ts(g.createdAt) || new Date() });
    const batchIds = new Set(p._batches.map((g) => g.id));
    const units = new Map(p._units.map((u) => [u.id, u]));

    // closings (active ones become the member's closing; reverted ones are kept only in the report)
    const closings = p._closings.map((c) => ({ ...c, dateMs: msOf(c.closingDate, c.closingDateMs) }))
      .filter((c) => { if (c.status && c.status !== "active") { r.skip("revertedClosing"); return false; } return Number.isFinite(c.dateMs); })
      .sort((a, c) => (a.seq || 0) - (c.seq || 0));
    const closingByMember = new Map(closings.map((c) => [c.memberId, c]));
    const closingById = new Map(closings.map((c) => [c.id, c]));

    const src = (membersByProgram.get(p.id) || []).sort((a, c) => (ts(a.createdAt)?.getTime() || 0) - (ts(c.createdAt)?.getTime() || 0));
    const memberMap = new Map();
    let memberNo = 0;
    for (const m of src) {
      const cl = closingByMember.get(m.id);
      const deleted = b(m.delete_flag);
      let status = { pending: "pending", accepted: "accepted", closed: "closed", blocked: "accepted", left: "removed" }[m.status] || "accepted";
      if (status === "closed" && !cl) { r.warn(`member ${s(m.displayName)} (${s(m.registrationNumber)}): closed hai par closing nahi mili → accepted`); status = "accepted"; }
      if (cl && status !== "removed") status = "closed";
      const joinMs = msOf(m.joinDate, m.joinDateMs);
      let dateJoin = msDay(joinMs) || day(m.joinDate);
      if (!dateJoin) { dateJoin = day(m.createdAt) || fmtISO(new Date()); r.warn(`member ${s(m.displayName)}: join date nahi → ${dateJoin}`); }
      const unit = units.get(m.groupId);
      const fee = n(m.joinFees);
      const row = {
        id: m.id, program_id: p.id, agent_id: agentIds.has(m.agentId) ? m.agentId : null,
        registration_number: s(m.registrationNumber), application_number: s(m.applicationNumber), member_number: ++memberNo,
        status, active: !deleted && m.status !== "blocked" && m.status !== "left", deleted, blocked: m.status === "blocked",
        display_name: s(m.displayName), father_name: s(m.fatherName), gender: s(m.gender), gotra: s(m.gotra), jati: s(m.jati),
        guardian: s(m.guardian), guardian_relation: s(m.guardianRelation), guardian_aadhar_no: s(m.guardianAadharNo),
        phone: s(m.phone), phone_alt: s(m.phoneAlt), aadhaar_no: s(m.aadhaarNo), birth_date: msDay(m.bobDateMs ?? m.dobMs) || day(m.bobDate ?? m.dob),
        current_address: s(m.currentAddress), village: s(m.village), district: s(m.district), state: s(m.state), pin_code: s(m.pinCode),
        age_group: s(m.ageGroup), age_group_range: s(m.ageGroupRange), member_group: s(m.groupName || unit?.name || m.memberGroup), location_group: s(m.locationGroup),
        location_group_id: s(m.locactionGroupId), closing_months: 0, membership_closing_date: null,
        date_join: dateJoin, pay_amount: m.payAmount === undefined || m.payAmount === null || m.payAmount === "" ? defaultPay : n(m.payAmount, defaultPay),
        join_fees: fee, join_fees_done: false, join_fees_txn_id: s(m.joinFeesTxtId), join_fees_payment_type: "",
        join_fees_paid_amount: 0, join_fees_remaining_amount: fee, // recalculated from join_fee_payments by the writer
        added_by: agentIds.has(m.agentId) ? "agent" : "admin", added_by_name: s(m.addedByName || m.agentName) || "Admin",
        photo_url: s(m.photoURL), extra_image_url: s(m.extraImageURL), document_front_url: s(m.documentFrontURL || m.aadhaarURL),
        document_back_url: s(m.documentBackURL), guardian_document_url: s(m.guardianDocumentURL), guardian_document_back_url: s(m.guardianDocumentBackURL),
        extra_details: JSON.stringify(Array.isArray(m.extraDetails) ? plain(m.extraDetails) : []), note: s(m.note),
        closing_date: status === "closed" ? msDay(cl.dateMs) : null, closing_at: status === "closed" ? ts(cl.createdAt) : null,
        closing_group_id: status === "closed" && batchIds.has(cl.batchId) ? cl.batchId : null,
        closing_notes: status === "closed" ? s(cl.notes) : "", invitation_card_url: status === "closed" ? s(cl.invitationCardURL) : "",
        pdf_data: status === "closed" && cl.pdfData && Object.keys(cl.pdfData).length ? JSON.stringify(plain(cl.pdfData)) : null,
        extra: JSON.stringify({ ...without(m, ["paidUpTo", "paidSeqs", "exemptSeqs", "partialPaid", "search_keywords", "displayName", "fatherName",
          "phone", "phoneAlt", "aadhaarNo", "village", "district", "state", "pinCode", "currentAddress", "photoURL", "extraImageURL", "documentFrontURL",
          "documentBackURL", "guardianDocumentURL", "extraDetails", "createdAt", "updatedAt", "id"]),
          ledger: { paidUpTo: m.paidUpTo ?? 0, paidSeqs: m.paidSeqs ?? [], exemptSeqs: m.exemptSeqs ?? [], partialPaid: m.partialPaid ?? {} } }),
        created_at: ts(m.createdAt) || new Date(), updated_at: ts(m.updatedAt) || ts(m.createdAt) || new Date(),
      };
      row._src = m; row._joinMs = joinMs; row._feePaidSource = feePaid(m);
      out.members.push(row);
      memberMap.set(m.id, row);
      for (const col of MEMBER_FILE_COLUMNS) if (isRemoteFile(row[col])) out.files.push({ table: "members", id: row.id, column: col, url: row[col] });
      if (row.status !== "pending" && row.registration_number && !row.deleted) {
        const digits = row.phone.replace(/\D/g, "").slice(-10);
        out.accounts.push({ role: "member", login_id: row.registration_number.toLowerCase(), email: null, phone: row.phone, display_name: row.display_name,
          password: digits.length >= 6 ? digits : `${row.display_name.split(" ")[0].toLowerCase().slice(0, 5) || "member"}${(row.birth_date || "").slice(0, 4) || "123"}`,
          generated: false, admin_id: adminId, agent_id: null, member_id: row.id, active: row.active && row.status !== "removed" });
      }
    }
    memberNo = Math.max(memberNo, 0);
    out.programs.at(-1).member_counter = memberNo;

    // dues from the ledger
    const dueDays = 45;
    const dueByPair = new Map();
    for (const m of src) {
      const row = memberMap.get(m.id);
      const led = { paidUpTo: n(m.paidUpTo), paid: new Set(ints(m.paidSeqs)), exempt: new Set(ints(m.exemptSeqs)), partial: m.partialPaid || {} };
      const me = { ...m, id: m.id, joinDateMs: row._joinMs, closingDateMs: closingByMember.get(m.id)?.dateMs ?? m.closingDateMs ?? null };
      for (const c of closings) {
        if (!isEligible(me, c)) continue;
        if (led.exempt.has(c.seq)) { r.skip("exemptDue"); continue; }
        const amount = amountFor(m, c);
        if (!(amount > 0)) continue;
        const settled = c.seq <= led.paidUpTo || led.paid.has(c.seq);
        const part = Math.min(Math.round(Number(led.partial[c.seq] || led.partial[String(c.seq)]) || 0), amount);
        const paid = settled ? amount : part;
        const due = {
          id: `${m.id}_${c.id}`.slice(0, 120), program_id: p.id, closing_member_id: c.memberId, payer_member_id: m.id,
          amount, paid_amount: paid, status: paid >= amount ? "paid" : paid > 0 ? "partial" : "pending",
          due_date: fmtISO(new Date(Date.parse(`${msDay(c.dateMs)}T12:00:00Z`) + dueDays * 864e5)), added_manually: false,
          paid_at: paid > 0 ? ts(m.lastPaymentAt) || ts(m.updatedAt) : null, payment_method: "", online_reference: "",
          created_at: ts(c.createdAt) || new Date(), updated_at: ts(m.updatedAt) || new Date(),
        };
        if (!memberMap.has(c.memberId)) { r.skip("closingMemberMissing", `closing seq ${c.seq}: closing wala member nahi mila → due chhoda`); continue; }
        dueByPair.set(`${m.id}|${c.id}`, due);
        out.dues.push(due);
      }
    }

    // receipts → transactions (+ join fee)
    for (const rc of p._payments) {
      const payer = memberMap.get(rc.memberId);
      if (!payer) { r.skip("orphanReceipt", `rasid ${s(rc.receiptNo)}: member nahi mila → chhodi`); continue; }
      const completed = rc.status !== "cancelled" && !b(rc.delete_flag);
      const dayPaid = msDay(rc.paidAtMs) || day(rc.createdAt) || fmtISO(new Date());
      const method = METHOD[String(rc.method || "cash").toLowerCase()] || "other";
      const items = Array.isArray(rc.items) ? rc.items : [];
      const batch = `R-${s(rc.receiptNo) || rc.id}`;
      const ids = [];
      items.forEach((it, i) => {
        const cl = closingById.get(it.closingId) || p._closings.find((c) => c.id === it.closingId || c.seq === it.seq);
        if (!cl || !memberMap.has(cl.memberId)) { r.skip("receiptItemNoClosing", `rasid ${s(rc.receiptNo)}: closing ${it.closingId || it.seq} nahi mili → item chhoda`); return; }
        let due = dueByPair.get(`${payer.id}|${cl.id}`);
        const amt = Math.round(Number(it.amount) || 0);
        if (!due && completed && amt > 0) {
          // money for a closing their rule no longer bills (dates changed later) — keep the money, make the due
          due = { id: `${payer.id}_${cl.id}`.slice(0, 120), program_id: p.id, closing_member_id: cl.memberId, payer_member_id: payer.id, amount: amt, paid_amount: 0,
            status: "pending", due_date: dayPaid, added_manually: true, paid_at: null, payment_method: "", online_reference: "", created_at: new Date(), updated_at: new Date() };
          dueByPair.set(`${payer.id}|${cl.id}`, due); out.dues.push(due);
          r.warn(`rasid ${s(rc.receiptNo)}: ${payer.display_name} ne closing seq ${cl.seq} ka ₹${amt} diya par unke niyam se ye due nahi tha → due bana diya (paisa surakshit)`);
        }
        const id = `${rc.id}-${i + 1}`;
        ids.push(id);
        out.transactions.push({
          id, program_id: p.id, transaction_number: items.length > 1 ? `${s(rc.receiptNo) || rc.id}-${i + 1}` : s(rc.receiptNo) || rc.id,
          batch_id: batch, sequence_number: i + 1, payer_member_id: payer.id, closing_member_id: cl.memberId, due_id: due?.id || null,
          amount: amt, is_full_payment: due ? amt >= due.amount : true, payment_method: method, payment_date: dayPaid, note: s(rc.note),
          online_reference: s(rc.reference), online_verified: b(rc.referenceVerified), transaction_type: "marriage_payment", bulk_payment_mode: rc.linkGroupId ? "linked" : "",
          status: completed ? "completed" : "reversed", created_by_id: "",
          extra: JSON.stringify({ receiptId: rc.id, receiptNo: s(rc.receiptNo), seq: it.seq ?? null, collectedByAgentId: rc.collectedByAgentId || null,
            collectedByAgentName: s(rc.collectedByAgentName), ...(completed ? {} : { reversedReason: s(rc.cancelReason) || "cancelled", reversedAt: plain(rc.cancelledAt) }) }),
          created_at: ts(rc.createdAt) || new Date(),
          _agentId: agentIds.has(rc.collectedByAgentId) ? rc.collectedByAgentId : null,
        });
      });
      txIds.set(rc.id, ids);
      const jf = Math.round(Number(rc.joinFeeAmount) || 0);
      if (jf > 0 && completed) {
        const id = `${rc.id}-jf`;
        feeIds.set(rc.id, id);
        out.joinFees.push({ id, program_id: p.id, member_id: payer.id, amount: jf, payment_mode: method, transaction_ref: s(rc.reference || rc.receiptNo),
          payment_date: dayPaid, note: `रसीद ${s(rc.receiptNo)}`, agent_id: agentIds.has(rc.collectedByAgentId) ? rc.collectedByAgentId : null,
          created_by_id: "", created_by_name: s(rc.collectedByAgentName) || "Office", extra: JSON.stringify({ receiptId: rc.id }), created_at: ts(rc.createdAt) || new Date() });
      }
    }

    // payouts, then commission entries (spread over the receipt's transactions)
    const payoutIds = new Set();
    for (const po of p._payouts) {
      if (!agentIds.has(po.agentId)) { r.skip("payoutNoAgent"); continue; }
      if (po.status === "draft") { r.skip("draftPayout", `payout ${s(po.payoutNo)} draft tha → chhoda (uski commission pending rahegi)`); continue; }
      payoutIds.add(po.id);
      out.payouts.push({ id: po.id, admin_id: adminId, agent_id: po.agentId, payout_number: s(po.payoutNo) || po.id, amount: Number(po.netTotal ?? po.grossTotal) || 0,
        payment_mode: s(po.method) || "cash", reference: s(po.reference), note: s(po.note), payout_date: msDay(po.paidAtMs) || day(po.createdAt) || fmtISO(new Date()),
        commission_count: n(po.entryCount), status: po.status === "cancelled" ? "reverted" : "paid", created_by_id: "", created_by_name: "Migration",
        reverted_at: po.status === "cancelled" ? ts(po.cancelledAt) || new Date() : null, revert_reason: po.status === "cancelled" ? s(po.cancelReason) || "cancelled" : "",
        created_at: ts(po.createdAt) || new Date() });
    }
    const txById = new Map(out.transactions.map((x) => [x.id, x]));
    for (const e of p._commissionEntries) {
      if (!agentIds.has(e.agentId)) { r.skip("commissionNoAgent"); continue; }
      const net = Math.round(((Number(e.amount) || 0) - (Number(e.reversedAmount) || 0)) * 100) / 100;
      const isFee = e.type === "join_fee" || e.sourceType === "joinFee";
      const status = e.status === "cancelled" ? "cancelled" : e.status === "paid" && payoutIds.has(e.payoutId) ? "paid" : "pending";
      const common = { admin_id: adminId, agent_id: e.agentId, program_id: p.id, member_id: memberMap.has(e.memberId) ? e.memberId : null, kind: "earned",
        rate_type: e.rateMode === "percent" ? "percentage" : "fixed", rate_value: Number(e.rateValue) || 0, status, payout_id: status === "paid" ? e.payoutId : null,
        payment_date: msDay(e.earnedAtMs) || day(e.createdAt) || fmtISO(new Date()), note: `Migration · ${s(e.receiptNo)}`,
        cancelled_at: status === "cancelled" ? ts(e.updatedAt) || new Date() : null, created_at: ts(e.createdAt) || new Date() };
      if (isFee) {
        const fid = feeIds.get(e.sourceId);
        if (!fid) { r.skip("commissionNoSource", `commission ${e.id}: join fee rasid nahi mili → chhodi`); continue; }
        out.commissions.push({ id: e.id, ...common, closing_member_id: null, source: "join_fees", source_id: fid, base_amount: Math.round(Number(e.baseAmount) || 0), amount: net });
        continue;
      }
      const ids = (txIds.get(e.sourceId) || []).filter((id) => txById.get(id)?.status === "completed" || status === "cancelled");
      if (!ids.length) { r.skip("commissionNoSource", `commission ${e.id}: rasid ${s(e.receiptNo)} nahi mili → chhodi`); continue; }
      const base = ids.reduce((a, id) => a + txById.get(id).amount, 0) || 1;
      let left = net;
      ids.forEach((id, i) => {
        const tx = txById.get(id);
        const amt = i === ids.length - 1 ? Math.round(left * 100) / 100 : Math.round((net * tx.amount / base) * 100) / 100;
        left -= amt;
        out.commissions.push({ id: i === 0 ? e.id : `${e.id}-${i + 1}`, ...common, closing_member_id: tx.closing_member_id, source: "closing", source_id: id, base_amount: tx.amount, amount: amt });
      });
    }
  }

  // pending agent requests → pending members
  const firstProgram = new Set(t.programs.map((p) => p.id));
  for (const q of t.requests) {
    if (!firstProgram.has(q.programId)) { r.skip("requestNoProgram"); continue; }
    const d = q.data || q.member || q;
    out.members.push({
      id: q.id, program_id: q.programId, agent_id: agentIds.has(q.agentId) ? q.agentId : null, registration_number: "", application_number: s(d.applicationNumber), member_number: 0,
      status: "pending", active: true, deleted: false, blocked: false, display_name: s(d.displayName) || "—", father_name: s(d.fatherName), gender: s(d.gender), gotra: s(d.gotra), jati: s(d.jati),
      guardian: s(d.guardian), guardian_relation: s(d.guardianRelation), guardian_aadhar_no: s(d.guardianAadharNo), phone: s(d.phone), phone_alt: s(d.phoneAlt), aadhaar_no: s(d.aadhaarNo),
      birth_date: msDay(d.bobDateMs) || day(d.bobDate), current_address: s(d.currentAddress), village: s(d.village), district: s(d.district), state: s(d.state), pin_code: s(d.pinCode),
      age_group: "", age_group_range: "", member_group: "", location_group: "", location_group_id: "", closing_months: 0, membership_closing_date: null,
      date_join: msDay(d.joinDateMs) || day(d.joinDate) || fmtISO(new Date()), pay_amount: n(d.payAmount, 200), join_fees: n(d.joinFees), join_fees_done: false, join_fees_txn_id: "",
      join_fees_payment_type: "", join_fees_paid_amount: 0, join_fees_remaining_amount: n(d.joinFees), added_by: "agent", added_by_name: s(q.agentName) || "Agent",
      photo_url: s(d.photoURL), extra_image_url: s(d.extraImageURL), document_front_url: s(d.documentFrontURL), document_back_url: s(d.documentBackURL),
      guardian_document_url: s(d.guardianDocumentURL), guardian_document_back_url: "", extra_details: "[]", note: s(d.note), closing_date: null, closing_at: null,
      closing_group_id: null, closing_notes: "", invitation_card_url: "", pdf_data: null, extra: JSON.stringify({ migratedRequest: true }), created_at: ts(q.createdAt) || new Date(), updated_at: new Date(),
    });
    for (const col of MEMBER_FILE_COLUMNS) { const u = out.members.at(-1)[col]; if (isRemoteFile(u)) out.files.push({ table: "members", id: q.id, column: col, url: u }); }
  }

  // joining fee: the member's paid figure vs. receipts — a legacy "paid" with no receipt gets a migration row
  const feeByMember = new Map();
  for (const j of out.joinFees) feeByMember.set(j.member_id, (feeByMember.get(j.member_id) || 0) + j.amount);
  for (const m of out.members) {
    if (!m._src) continue;
    const want = Math.min(Math.round(m._feePaidSource || 0), m.join_fees || Infinity);
    const have = feeByMember.get(m.id) || 0;
    if (want > have) {
      out.joinFees.push({ id: `${m.id}-jf-mig`, program_id: m.program_id, member_id: m.id, amount: want - have, payment_mode: "other", transaction_ref: "",
        payment_date: m.date_join, note: "पुराना हिसाब (migration)", agent_id: m.agent_id, created_by_id: "", created_by_name: "Migration", extra: JSON.stringify({ migrationFill: true }), created_at: new Date() });
      r.warn(`${m.display_name}: नामांकन शुल्क ₹${want} जमा लिखा था पर रसीद ₹${have} की — ₹${want - have} की migration entry`);
    }
  }
  for (const m of out.members) { delete m._src; delete m._joinMs; delete m._feePaidSource; }

  out.money = {
    receiptsClosing: out.transactions.filter((x) => x.status === "completed").reduce((a, x) => a + x.amount, 0),
    ledgerPaid: out.dues.reduce((a, d) => a + d.paid_amount, 0),
    joinFees: out.joinFees.reduce((a, j) => a + j.amount, 0),
    commission: Math.round(out.commissions.filter((c) => c.status !== "cancelled").reduce((a, c) => a + c.amount, 0)),
  };
  out.warnings = r.warnings;
  out.skipped = r.skipped;
  out.counts = countBundle(out);
  out.source = { kind: KIND, id: adminId };
  out.recalcJoinFees = true;
  return out;
}
