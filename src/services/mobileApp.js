// Everything the agent / member mobile app needs that the web panel's endpoints do not give in
// one piece: app status + settings, a member's whole account (closings, timing, receipts, fee),
// the member's family (same mobile number), agent overview / members / closings / closing
// groups / requests / commission, and the PDFs the app downloads.
//
// Access rules (never trust the client):
//   agent  → only members whose agent_id is his
//   member → himself and his family (same 10-digit mobile number, same trust)
//   admin  → any member of his trust
import { sql, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db, schema } from "../db/index.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { camel } from "../lib/case.js";
import { todayIST, fmtISO } from "../lib/dates.js";
import { normalizeAppSettings, publicAppStatus } from "../lib/appSettings.js";
import { displayCount, normalizeCountDisplay } from "../lib/memberCountDisplay.js";
import { advanceBalance } from "./advances.js";
import { limitStatus } from "./fixedLimit.js";
import { isOn } from "../lib/features.js";
import { loginBlock } from "../lib/auth.js";
import { getTrustFeatures } from "./features.js";
import { normalizeTrust } from "../lib/trust/profile.js";
import { normalizeReceiptSettings, upiLink } from "../lib/receiptSettings.js";
import { commissionSummary, listCommissions, listPayouts } from "./commissions.js";

const today = () => fmtISO(todayIST());
const ten = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const n = (v) => Number(v) || 0;
const iso = (v) => (v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

/* ── settings ─────────────────────────────────────────────────────────── */

/** Logo link for the app: an uploaded file as is; an inline data: logo via /api/app/logo (with a version so phones refresh). */
export function appLogo(logo) {
  const v = String(logo || "");
  if (!v) return null;
  if (!v.startsWith("data:")) return v;
  let h = 0;
  for (let i = 0; i < v.length; i += 97) h = (h * 31 + v.charCodeAt(i)) | 0;
  return `/api/app/logo?v=${(h >>> 0).toString(36)}`;
}

export async function firstAdmin() {
  return db.query.admins.findFirst({ orderBy: (a, { asc }) => [asc(a.createdAt)] });
}

export async function getAppSettings(adminId) {
  const ad = adminId ? await db.query.admins.findFirst({ where: eq(schema.admins.id, adminId) }) : await firstAdmin();
  return normalizeAppSettings(ad?.extra?.app);
}

export async function saveAppSettings(adminId, body) {
  const clean = normalizeAppSettings(body);
  // app member count, "fixed" per yojna: remember the real count when the number was set (then + new members)
  if (Object.keys(clean.memberCount.custom).length) {
    const prev = (await getAppSettings(adminId)).memberCount.custom;
    const actual = await membersOnBooks(adminId);
    for (const [pid, c] of Object.entries(clean.memberCount.custom)) {
      if (!actual.has(pid)) { delete clean.memberCount.custom[pid]; continue; } // not this trust's yojna
      clean.memberCount.custom[pid] = normalizeCountDisplay(c, prev[pid], actual.get(pid));
    }
  }
  await db.execute(sql`UPDATE admins SET extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('app', ${JSON.stringify(clean)}::jsonb) WHERE id = ${adminId}`);
  return clean;
}

/** programId → members on books (accepted + closed, not deleted; pending requests not counted) — same as the panel. */
async function membersOnBooks(adminId) {
  const { rows } = await db.execute(sql`
    SELECT p.id, count(m.id) FILTER (WHERE NOT m.deleted AND m.status IN ('accepted', 'closed'))::int AS n
    FROM programs p LEFT JOIN members m ON m.program_id = p.id WHERE p.admin_id = ${adminId} GROUP BY p.id`);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * Yojna ki kul sadasya sankhya for the app (Settings → Mobile App → "Member count").
 * { show: false } when switched off for this login type; else { show: true, programs: [{ id, name, count }] }.
 *   source yojna  → the yojna's own "Member count kaise dikhe" (same number as the panel)
 *          actual → real count
 *          custom → per-yojna percent / fixed set for the app
 * Percent / fixed only when the trust has "Member count display" (feature-control); otherwise real count.
 */
export async function appMemberCount(auth) {
  const s = (await getAppSettings(auth.adminId)).memberCount;
  const on = auth.role === "agent" ? s.agents : auth.role === "member" ? s.members : false;
  if (!on) return { show: false };
  const { rows } = await db.execute(sql`
    SELECT p.id, p.name, p.hiname, p.extra->'countDisplay' AS cd,
      count(m.id) FILTER (WHERE NOT m.deleted AND m.status IN ('accepted', 'closed'))::int AS n
    FROM programs p LEFT JOIN members m ON m.program_id = p.id
    WHERE p.admin_id = ${auth.adminId}
    GROUP BY p.id ORDER BY p.created_at`);
  const shaped = auth.features?.countDisplay !== false;
  let list = rows;
  if (auth.role === "member") {
    // a member sees only the yojna(s) he and his family are in
    const ids = await familyIds(auth);
    const { rows: mine } = await db.execute(sql`SELECT DISTINCT program_id FROM members WHERE id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
    const set = new Set(mine.map((r) => r.program_id));
    list = rows.filter((r) => set.has(r.id));
  }
  return {
    show: true,
    programs: list.map((r) => {
      const cfg = !shaped || s.source === "actual" ? null : s.source === "custom" ? s.custom[r.id] : r.cd;
      return { id: r.id, name: r.hiname || r.name, count: displayCount(r.n, cfg) };
    }),
  };
}

/** Public: maintenance, update, payment switches (the app checks this before anything else). */
export async function appStatus() {
  const ad = await firstAdmin();
  const st = publicAppStatus(ad?.extra?.app);
  const f = ad ? await getTrustFeatures(ad.id) : null;
  // which login the app may offer — /feature-control (member / agent login, panel closed, plan over)
  const memberBlock = f ? loginBlock({ role: "member" }, f) : null;
  const agentBlock = f ? loginBlock({ role: "agent" }, f) : null;
  st.login = { member: !memberBlock, agent: !agentBlock, message: memberBlock && agentBlock ? memberBlock : "" };
  // "भुगतान करें": feature on, and a way to pay — UPI (app or receipt settings), QR, or bank
  if (!paymentWayFor(ad) || (f && !isOn(f, "appPayment"))) st.payment = { members: false, agents: false };
  return st;
}

function paymentWayFor(ad) {
  const s = normalizeAppSettings(ad?.extra?.app);
  const rs = normalizeReceiptSettings(ad?.extra?.receipt);
  return Boolean(s.payment.upiId || rs.upiId || s.payment.qrImage || s.payment.bank?.accountNumber);
}

/** Trust details for the app's "about / contact" (public). */
export async function appAbout(adminId) {
  const ad = adminId ? await db.query.admins.findFirst({ where: eq(schema.admins.id, adminId) }) : await firstAdmin();
  const t = normalizeTrust(ad?.trustInfo || {});
  const s = normalizeAppSettings(ad?.extra?.app);
  const phones = String(t.contact || "").split(/[,/|]/).map((x) => x.trim()).filter(Boolean);
  return {
    name: t.name, shortName: t.shortName, cityState: t.cityState, address: t.address,
    logo: appLogo(t.logo),
    topTitle: t.topTitle || [], regNo: t.regNo, govtRegNo: t.govtRegNo, president: t.trustPresident, founder: t.founder,
    contactPerson: t.contactPerson, website: s.support.website || t.website, aboutText: s.aboutText || t.about,
    phones,
    support: {
      phone: s.support.phone || phones[0] || "",
      whatsapp: s.support.whatsapp || ten(phones[0]) || "",
      email: s.support.email || t.email || "",
      officeHours: s.support.officeHours,
    },
  };
}

/** "भुगतान करें": UPI / bank / QR for the amount on screen. */
export async function paymentInfo(auth, { amount, note }) {
  const ad = await db.query.admins.findFirst({ where: eq(schema.admins.id, auth.adminId) });
  const s = normalizeAppSettings(ad?.extra?.app);
  const allowed = auth.role === "agent" ? s.payment.agents : auth.role === "member" ? s.payment.members : true;
  const f = await getTrustFeatures(auth.adminId);
  if (!allowed || !paymentWayFor(ad) || !isOn(f, "appPayment")) throw forbidden("ऐप से भुगतान अभी बंद है");
  const rs = normalizeReceiptSettings(ad?.extra?.receipt);
  const trust = normalizeTrust(ad?.trustInfo || {});
  const upiId = s.payment.upiId || rs.upiId || "";
  const payeeName = s.payment.payeeName || rs.upiName || trust.name;
  const amt = Math.max(0, Math.round(n(amount)));
  const cleanNote = String(note || "").replace(/[^\w @./-]/g, "").slice(0, 50);
  let link = "", qrDataUrl = "";
  if (upiId) {
    link = upiLink({ upiId, upiName: payeeName, amount: amt, note: cleanNote });
    qrDataUrl = await QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 1, width: 480 });
  }
  const b = s.payment.bank;
  return {
    payeeName, upiId, upiLink: link, qrDataUrl, amount: amt,
    qrImageURL: s.payment.qrImage || null,
    bank: b.accountNumber ? b : null,
    confirmWhatsapp: s.payment.confirmWhatsapp || ten(trust.contact),
    steps: s.payment.steps, note: s.payment.note,
    requests: isOn(f, "paymentRequests"), // "भुगतान का अनुरोध भेजें" (UTR + screenshot → office approves)
  };
}

/* ── who may see which member ─────────────────────────────────────────── */

export async function memberRow(memberId) {
  const { rows: [m] } = await db.execute(sql`
    SELECT m.*, p.admin_id, p.name AS program_name, p.hiname AS program_hiname, p.due_days,
           a.display_name AS agent_name, a.phone AS agent_phone
    FROM members m JOIN programs p ON p.id = m.program_id LEFT JOIN agents a ON a.id = m.agent_id
    WHERE m.id = ${memberId} AND NOT m.deleted`);
  return m || null;
}

/** Ids of everyone on this member's mobile number in the same trust (himself first). */
export async function familyIds(auth) {
  if (!auth.memberId) return [];
  const me = await memberRow(auth.memberId);
  if (!me) return [];
  const phone = ten(me.phone);
  if (!phone) return [me.id];
  const { rows } = await db.execute(sql`
    SELECT m.id FROM members m JOIN programs p ON p.id = m.program_id
    WHERE p.admin_id = ${me.admin_id} AND NOT m.deleted AND m.status IN ('accepted', 'closed')
      AND (right(regexp_replace(m.phone, '\\D', '', 'g'), 10) = ${phone} OR right(regexp_replace(m.phone_alt, '\\D', '', 'g'), 10) = ${phone})
    ORDER BY (m.id = ${me.id}) DESC, m.date_join, m.display_name`);
  const ids = rows.map((r) => r.id);
  return ids.includes(me.id) ? ids : [me.id, ...ids];
}

export async function memberFor(auth, memberId) {
  const m = await memberRow(memberId);
  if (!m) throw notFound("सदस्य नहीं मिला");
  if (auth.role === "owner") return m;
  if (m.admin_id !== auth.adminId) throw forbidden();
  if (auth.role === "agent" && m.agent_id !== auth.agentId) throw forbidden("यह सदस्य आपका नहीं है");
  if (auth.role === "member" && m.id !== auth.memberId && !(await familyIds(auth)).includes(m.id)) throw forbidden();
  return m;
}

/* ── one member's account ─────────────────────────────────────────────── */

function closingSeqCte(programId) {
  return sql`SELECT id, row_number() OVER (ORDER BY closing_date, closing_at NULLS FIRST, created_at, id)::int AS seq
             FROM members WHERE program_id = ${programId} AND closing_date IS NOT NULL AND NOT deleted`;
}

const STATUS = { accepted: "accepted", closed: "closed", pending: "pending", rejected: "rejected", removed: "removed" };

export function shapeMember(m) {
  return {
    id: m.id, programId: m.program_id, programName: m.program_hiname || m.program_name,
    displayName: m.display_name, fatherName: m.father_name, registrationNumber: m.registration_number || "",
    applicationNumber: m.application_number || "", phone: m.phone, phoneAlt: m.phone_alt,
    aadhaarNo: m.aadhaar_no ? `XXXX XXXX ${String(m.aadhaar_no).slice(-4)}` : "",
    gender: m.gender, gotra: m.gotra, jati: m.jati, guardian: m.guardian, guardianRelation: m.guardian_relation,
    guardianAadharNo: m.guardian_aadhar_no ? `XXXX XXXX ${String(m.guardian_aadhar_no).replace(/\D/g, "").slice(-4)}` : "",
    documents: [
      ["photo", "सदस्य का फोटो", m.photo_url],
      ["front", "आधार (आगे)", m.document_front_url],
      ["back", "आधार (पीछे)", m.document_back_url],
      ["guardianPhoto", "वारिसदार फोटो", m.extra_image_url],
      ["guardianFront", "वारिसदार आधार (आगे)", m.guardian_document_url],
      ["guardianBack", "वारिसदार आधार (पीछे)", m.guardian_document_back_url],
    ].filter(([, , url]) => url && !String(url).startsWith("data:")).map(([key, label, url]) => ({ key, label, url })),
    birthDate: iso(m.birth_date), dateJoin: iso(m.date_join), closingDate: iso(m.closing_date),
    village: m.village, district: m.district, state: m.state, pinCode: m.pin_code, currentAddress: m.current_address,
    photoUrl: m.photo_url, payAmount: m.pay_amount,
    status: m.blocked ? "blocked" : m.closing_date ? "closed" : STATUS[m.status] || m.status,
    agentName: m.agent_name || "", agentPhone: m.agent_phone || "", ageGroupRange: m.age_group_range || "",
  };
}

/** The whole account: closings with timing, receipts, joining fee and totals. */
export async function memberDetail(memberId, m0 = null) {
  const m = m0 || (await memberRow(memberId));
  if (!m) throw notFound("सदस्य नहीं मिला");
  const t = today();
  const { rows: tl } = await db.execute(sql`
    WITH cl AS (${closingSeqCte(m.program_id)})
    SELECT d.id, d.status::text AS status, d.amount, d.paid_amount, d.due_date, d.paid_date,
      c.id AS closing_id, c.display_name AS name, c.registration_number AS reg_no, c.village, c.closing_date,
      c.closing_group_id AS batch_id, g.name AS batch_name, cl.seq,
      (SELECT t.transaction_number FROM transactions t WHERE t.due_id = d.id AND t.status = 'completed' ORDER BY t.created_at DESC LIMIT 1) AS receipt_no
    FROM dues d JOIN members c ON c.id = d.closing_member_id
    LEFT JOIN closing_groups g ON g.id = c.closing_group_id
    LEFT JOIN cl ON cl.id = c.id
    WHERE d.payer_member_id = ${m.id}
    ORDER BY c.closing_date, cl.seq`);
  // dues in a payment request the office has not checked yet → "जाँच में" (not to be paid twice)
  const { rows: inReq } = await db.execute(sql`
    SELECT DISTINCT did FROM payment_requests r, jsonb_array_elements(r.items) it, jsonb_array_elements_text(it->'dueIds') did
    WHERE r.admin_id = ${m.admin_id} AND r.status = 'pending' AND it->>'memberId' = ${m.id}`);
  const requested = new Set(inReq.map((x) => x.did));
  const timeline = tl.map((r) => {
    const remaining = r.status === "paid" ? 0 : r.amount - r.paid_amount;
    const due = iso(r.due_date);
    const paid = iso(r.paid_date);
    const days = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
    const overdue = remaining > 0 && due && due < t;
    let timing = null;
    if (r.status === "paid") timing = !due || !paid || paid <= due ? "onTime" : "late";
    return {
      id: r.id, seq: r.seq || 0, closingId: r.closing_id, name: r.name, regNo: r.reg_no || "", village: r.village || "",
      date: iso(r.closing_date), dueBy: due, paidAt: paid, receiptNo: r.receipt_no || "",
      batchId: r.batch_id || null, batchName: r.batch_name || "",
      amount: r.amount, paid: r.paid_amount, remaining, status: r.status, requested: remaining > 0 && requested.has(r.id),
      timing, lateByDays: timing === "late" ? days(paid, due) : 0, overdue: !!overdue, overdueDays: overdue ? days(t, due) : 0,
    };
  });
  const s = {
    eligibleCount: timeline.length, paidAmount: 0, paidCount: 0, pendingAmount: 0, pendingCount: 0,
    onTimeAmount: 0, onTimeCount: 0, lateAmount: 0, lateCount: 0, overdueAmount: 0, overdueCount: 0,
  };
  for (const r of timeline) {
    s.paidAmount += r.paid;
    if (r.status === "paid") s.paidCount++;
    if (r.remaining > 0) { s.pendingAmount += r.remaining; s.pendingCount++; }
    if (r.timing === "onTime") { s.onTimeCount++; s.onTimeAmount += r.paid; }
    if (r.timing === "late") { s.lateCount++; s.lateAmount += r.paid; }
    if (r.overdue) { s.overdueCount++; s.overdueAmount += r.remaining; }
  }
  // receipts: one per payment batch (same as one rasid), plus joining-fee instalments
  const { rows: rc } = await db.execute(sql`
    WITH cl AS (${closingSeqCte(m.program_id)})
    SELECT t.batch_id, min(t.transaction_number) AS receipt_no, min(t.payment_date) AS paid_at, max(t.payment_method) AS method,
      sum(t.amount)::int AS total, count(*)::int AS item_count, bool_and(t.status = 'reversed') AS cancelled,
      max(t.online_reference) AS ref, min(t.created_at) AS created_at,
      json_agg(json_build_object('seq', cl.seq, 'name', c.display_name) ORDER BY cl.seq) AS items
    FROM transactions t LEFT JOIN members c ON c.id = t.closing_member_id LEFT JOIN cl ON cl.id = c.id
    WHERE t.payer_member_id = ${m.id}
    GROUP BY t.batch_id ORDER BY min(t.payment_date) DESC, min(t.created_at) DESC`);
  const { rows: jf } = await db.execute(sql`
    SELECT id, amount, payment_mode, transaction_ref, payment_date, created_at FROM join_fee_payments WHERE member_id = ${m.id}`);
  const receipts = [
    ...rc.map((r) => ({
      id: r.batch_id, kind: "closing", receiptNo: r.receipt_no, paidAt: iso(r.paid_at), method: r.method, ref: r.ref || "",
      totalAmount: r.total, itemCount: r.item_count, status: r.cancelled ? "cancelled" : "ok", items: (r.items || []).filter((x) => x.name),
    })),
    ...jf.map((j) => ({
      id: `fee:${j.id}`, kind: "fee", receiptNo: "नामांकन शुल्क", paidAt: iso(j.payment_date), method: j.payment_mode, ref: j.transaction_ref || "",
      totalAmount: j.amount, itemCount: 0, joinFeeAmount: j.amount, status: "ok", items: [],
    })),
  ].sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
  const feeTotal = n(m.join_fees), feePaid = n(m.join_fees_paid_amount);
  return {
    member: shapeMember(m),
    summary: s,
    joinFee: { total: feeTotal, paid: feePaid, due: Math.max(feeTotal - feePaid, 0), done: feeTotal > 0 ? feePaid >= feeTotal : true },
    advance: await advanceBalance(m.id), // अग्रिम jama (closing payment mein kaat sakte hain)
    fixedLimit: await (async () => { const l = await limitStatus(m.id); return l.limit == null ? null : l; })(), // निश्चित राशि
    timeline,
    receipts,
    graceDays: m.due_days ?? 45,
    lastPaymentAt: receipts.find((r) => r.status === "ok")?.paidAt || null,
  };
}

/** Member app: everyone on this mobile number, each with the whole account. */
export async function family(auth) {
  const ids = await familyIds(auth);
  const members = [];
  for (const id of ids) {
    const m = await memberRow(id);
    if (!m) continue;
    const d = await memberDetail(id, m);
    members.push({ ...d.member, summary: d.summary, joinFee: d.joinFee, timeline: d.timeline, receipts: d.receipts, graceDays: d.graceDays,
      dueAmount: d.summary.pendingAmount, dueCount: d.summary.pendingCount, paidAmount: d.summary.paidAmount, joinFeesDue: d.joinFee.due,
      advance: auth.features?.advancePayment === false ? 0 : d.advance, fixedLimit: auth.features?.fixedLimit === false ? null : d.fixedLimit });
  }
  const programs = [];
  for (const m of members) if (!programs.find((p) => p.id === m.programId)) programs.push({ id: m.programId, name: m.programName });
  return { members, programs };
}

/* ── agent ────────────────────────────────────────────────────────────── */

function needAgent(auth) {
  if (auth.role !== "agent" || !auth.agentId) throw forbidden("यह सिर्फ़ एजेंट के लिए है");
}

async function programFor(auth, programId) {
  const { rows } = await db.execute(sql`
    SELECT id, name, hiname, is_selected, age_groups, location_groups, default_pay_amount, due_days
    FROM programs WHERE admin_id = ${auth.adminId} ORDER BY created_at DESC`);
  const p = rows.find((r) => r.id === programId) || rows.find((r) => r.is_selected) || rows[0];
  if (!p) throw notFound("कोई योजना नहीं मिली");
  return { program: p, programs: rows };
}

/** Per-member money of the agent's members (one row each). */
function agentMemberAgg(programId, agentId) {
  return sql`
    SELECT m.*, COALESCE(x.due_amount, 0)::int AS due_amount, COALESCE(x.due_count, 0)::int AS due_count,
      COALESCE(x.paid_amount, 0)::int AS paid_amount,
      GREATEST(m.join_fees - m.join_fees_paid_amount, 0)::int AS fee_due
    FROM members m
    LEFT JOIN LATERAL (
      SELECT sum(d.amount - d.paid_amount) FILTER (WHERE d.status <> 'paid') AS due_amount,
             count(*) FILTER (WHERE d.status <> 'paid') AS due_count, sum(d.paid_amount) AS paid_amount
      FROM dues d WHERE d.payer_member_id = m.id) x ON true
    WHERE m.program_id = ${programId} AND m.agent_id = ${agentId} AND NOT m.deleted AND m.status IN ('accepted', 'closed')`;
}

export async function agentOverview(auth, programId) {
  needAgent(auth);
  const { program, programs } = await programFor(auth, programId);
  const { rows: [c] } = await db.execute(sql`
    WITH a AS (${agentMemberAgg(program.id, auth.agentId)})
    SELECT count(*)::int AS members,
      count(*) FILTER (WHERE status = 'accepted' AND closing_date IS NULL AND NOT blocked)::int AS accepted,
      count(*) FILTER (WHERE closing_date IS NOT NULL)::int AS closed,
      count(*) FILTER (WHERE blocked)::int AS blocked,
      count(*) FILTER (WHERE due_amount > 0)::int AS with_due,
      COALESCE(sum(due_count), 0)::int AS due_count, COALESCE(sum(due_amount), 0)::int AS due_amount,
      COALESCE(sum(paid_amount), 0)::int AS paid_amount,
      COALESCE(sum(fee_due), 0)::int AS fee_due, COALESCE(sum(join_fees_paid_amount), 0)::int AS fee_paid,
      COALESCE(sum(join_fees), 0)::int AS fee_total, count(*) FILTER (WHERE fee_due > 0)::int AS fee_pending_members
    FROM a`);
  const { rows: counts } = await db.execute(sql`
    SELECT program_id, count(*)::int AS n FROM members
    WHERE agent_id = ${auth.agentId} AND NOT deleted AND status IN ('accepted', 'closed') GROUP BY program_id`);
  const { rows: [rq] } = await db.execute(sql`
    SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
           count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
           count(*) FILTER (WHERE status IN ('accepted', 'closed'))::int AS approved
    FROM members WHERE agent_id = ${auth.agentId} AND added_by = 'agent' AND NOT deleted`);
  const { rows: [col] } = await db.execute(sql`
    SELECT COALESCE(sum(t.amount), 0)::int AS collected FROM transactions t
    JOIN accounts acc ON acc.id = t.created_by_id
    WHERE acc.agent_id = ${auth.agentId} AND t.status = 'completed'`);
  const ag = await db.query.agents.findFirst({ where: eq(schema.agents.id, auth.agentId) });
  let com = { earned: 0, paid: 0, pending: 0 };
  try { com = await commissionSummary(auth.adminId, auth.agentId); } catch { /* agent without commission */ }
  return {
    programId: program.id,
    programs: programs.map((p) => ({
      id: p.id, name: p.name, hiname: p.hiname, members: counts.find((x) => x.program_id === p.id)?.n || 0,
      ageGroups: p.age_groups || [], locationGroups: p.location_groups || [], defaultPayAmount: p.default_pay_amount, dueDays: p.due_days,
    })),
    agent: {
      id: ag?.id, displayName: ag?.displayName || auth.displayName, phone: ag?.phone || "", email: ag?.email || "",
      earnedTotal: n(com.earned) - Math.abs(n(com.reversed)), paidTotal: n(com.paid), dueTotal: n(com.pending), collectedAmount: col?.collected || 0,
    },
    current: camel(c),
    requests: rq,
  };
}

const MEMBER_FILTERS = {
  all: sql``,
  due: sql`AND due_amount > 0`,
  paid: sql`AND due_amount = 0`,
  feeDue: sql`AND fee_due > 0`,
  feeDone: sql`AND fee_due = 0`,
  active: sql`AND status = 'accepted' AND closing_date IS NULL AND NOT blocked`,
  closed: sql`AND closing_date IS NOT NULL`,
  blocked: sql`AND blocked`,
};

export async function agentMembers(auth, { programId, f = "all", q = "", page = 1, limit = 50 } = {}) {
  needAgent(auth);
  const { program } = await programFor(auth, programId);
  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = (Math.max(Number(page) || 1, 1) - 1) * size;
  const like = q && String(q).trim().length >= 2 ? `%${String(q).trim()}%` : null;
  const where = sql`WHERE true ${MEMBER_FILTERS[f] || sql``}
    ${like ? sql`AND (display_name ILIKE ${like} OR father_name ILIKE ${like} OR registration_number ILIKE ${like}
      OR application_number ILIKE ${like} OR phone ILIKE ${like} OR village ILIKE ${like})` : sql``}`;
  const order = f === "due" ? sql`due_amount DESC, display_name` : sql`substring(registration_number from '[0-9]+')::bigint NULLS LAST, registration_number, display_name`;
  const { rows } = await db.execute(sql`
    WITH a AS (${agentMemberAgg(program.id, auth.agentId)})
    SELECT *, count(*) OVER()::int AS total_count, sum(due_amount) OVER()::int AS t_due, sum(paid_amount) OVER()::int AS t_paid,
      sum(fee_due) OVER()::int AS t_fee_due, sum(join_fees_paid_amount) OVER()::int AS t_fee_paid
    FROM a ${where} ORDER BY ${order} LIMIT ${size} OFFSET ${off}`);
  const total = rows[0]?.total_count || 0;
  return {
    programId: program.id,
    members: rows.map((m) => ({ ...shapeMember(m), dueAmount: m.due_amount, dueCount: m.due_count, paidAmount: m.paid_amount, joinFeesDue: m.fee_due })),
    total, page: Number(page) || 1, pages: Math.max(1, Math.ceil(total / size)),
    totals: { dueAmount: rows[0]?.t_due || 0, paidAmount: rows[0]?.t_paid || 0, feeDueAmount: rows[0]?.t_fee_due || 0, feePaidAmount: rows[0]?.t_fee_paid || 0 },
  };
}

/** Every closing of the yojna, with how this agent's members stand on it, + closing groups. */
export async function agentClosings(auth, { programId } = {}) {
  needAgent(auth);
  const { program } = await programFor(auth, programId);
  const { rows } = await db.execute(sql`
    WITH cl AS (${closingSeqCte(program.id)})
    SELECT c.id, cl.seq, c.display_name AS name, c.registration_number AS reg_no, c.village, c.closing_date, c.photo_url,
      c.closing_group_id AS batch_id, g.name AS batch_name,
      count(d.id)::int AS members, count(d.id) FILTER (WHERE d.status = 'paid')::int AS paid_count,
      count(d.id) FILTER (WHERE d.status <> 'paid')::int AS pending_count,
      COALESCE(sum(d.paid_amount), 0)::int AS paid_amount,
      COALESCE(sum(d.amount - d.paid_amount) FILTER (WHERE d.status <> 'paid'), 0)::int AS pending_amount,
      max(d.due_date) AS due_by
    FROM members c JOIN cl ON cl.id = c.id
    LEFT JOIN closing_groups g ON g.id = c.closing_group_id
    LEFT JOIN dues d ON d.closing_member_id = c.id AND d.payer_member_id IN (SELECT id FROM members WHERE agent_id = ${auth.agentId} AND NOT deleted)
    GROUP BY c.id, cl.seq, g.name
    ORDER BY c.closing_date DESC, cl.seq DESC`);
  const closings = rows.map((r) => ({
    id: r.id, seq: r.seq, name: r.name, regNo: r.reg_no || "", village: r.village || "", date: iso(r.closing_date), photoUrl: r.photo_url,
    batchId: r.batch_id, batchName: r.batch_name || "", dueBy: iso(r.due_by),
    members: r.members, paidCount: r.paid_count, pendingCount: r.pending_count, paidAmount: r.paid_amount, pendingAmount: r.pending_amount,
  }));
  const map = new Map();
  for (const c of closings) {
    const id = c.batchId || "_none";
    const b = map.get(id) || { id, name: c.batchName || "बिना समूह", closings: 0, paidAmount: 0, pendingAmount: 0, paidCount: 0, pendingCount: 0, dueBy: null, lastDate: null };
    b.closings++; b.paidAmount += c.paidAmount; b.pendingAmount += c.pendingAmount; b.paidCount += c.paidCount; b.pendingCount += c.pendingCount;
    if (c.dueBy && (!b.dueBy || c.dueBy > b.dueBy)) b.dueBy = c.dueBy;
    if (!b.lastDate || c.date > b.lastDate) b.lastDate = c.date;
    map.set(id, b);
  }
  const batches = [...map.values()].sort((a, b) => (a.id === "_none") - (b.id === "_none") || String(b.lastDate).localeCompare(String(a.lastDate)));
  const totals = closings.reduce((t, c) => ({ closings: t.closings + 1, paidAmount: t.paidAmount + c.paidAmount, pendingAmount: t.pendingAmount + c.pendingAmount,
    paidCount: t.paidCount + c.paidCount, pendingCount: t.pendingCount + c.pendingCount }), { closings: 0, paidAmount: 0, pendingAmount: 0, paidCount: 0, pendingCount: 0 });
  const { rows: [mc] } = await db.execute(sql`SELECT count(*)::int AS n FROM members WHERE program_id = ${program.id} AND agent_id = ${auth.agentId} AND NOT deleted AND status IN ('accepted','closed')`);
  return { programId: program.id, closings, batches, totals, members: mc.n };
}

/** Rows of the agent's payers for some dues, with each one's whole pending total. */
async function payerRows(auth, dueWhere) {
  const { rows } = await db.execute(sql`
    SELECT p.id, p.display_name, p.father_name, p.registration_number, p.village, p.phone, p.photo_url,
      count(d.id)::int AS closings, count(d.id) FILTER (WHERE d.status <> 'paid')::int AS pending_closings,
      COALESCE(sum(d.paid_amount), 0)::int AS paid,
      COALESCE(sum(d.amount - d.paid_amount) FILTER (WHERE d.status <> 'paid'), 0)::int AS remaining,
      COALESCE(sum(d.amount), 0)::int AS amount, max(d.status::text) AS status,
      (SELECT COALESCE(sum(x.amount - x.paid_amount), 0)::int FROM dues x WHERE x.payer_member_id = p.id AND x.status <> 'paid') AS total_due_amount,
      (SELECT count(*)::int FROM dues x WHERE x.payer_member_id = p.id AND x.status <> 'paid') AS total_due_count
    FROM dues d JOIN members p ON p.id = d.payer_member_id JOIN members c ON c.id = d.closing_member_id
    WHERE p.agent_id = ${auth.agentId} AND NOT p.deleted AND ${dueWhere}
    GROUP BY p.id ORDER BY remaining DESC, p.display_name`);
  return rows.map((r) => ({
    id: r.id, displayName: r.display_name, fatherName: r.father_name, registrationNumber: r.registration_number || "", village: r.village,
    phone: r.phone, photoUrl: r.photo_url, closings: r.closings, pendingClosings: r.pending_closings, paid: r.paid, remaining: r.remaining,
    amount: r.amount, status: r.remaining > 0 ? (r.paid > 0 ? "partial" : "pending") : "paid", totalDueAmount: r.total_due_amount, totalDueCount: r.total_due_count,
  }));
}

const rowTotals = (rows) => rows.reduce((t, r) => ({
  members: t.members + 1, amount: t.amount + r.amount, paidAmount: t.paidAmount + r.paid, pendingAmount: t.pendingAmount + r.remaining,
  pendingCount: t.pendingCount + (r.remaining > 0 ? 1 : 0), paidCount: t.paidCount + (r.remaining > 0 ? 0 : 1),
  pendingMembers: t.pendingMembers + (r.remaining > 0 ? 1 : 0), paidMembers: t.paidMembers + (r.remaining > 0 ? 0 : 1),
}), { members: 0, amount: 0, paidAmount: 0, pendingAmount: 0, pendingCount: 0, paidCount: 0, pendingMembers: 0, paidMembers: 0 });

export async function agentClosing(auth, closingId) {
  needAgent(auth);
  const c = await memberRow(closingId);
  if (!c || c.admin_id !== auth.adminId || !c.closing_date) throw notFound("क्लोजिंग नहीं मिली");
  const { rows: [s] } = await db.execute(sql`WITH cl AS (${closingSeqCte(c.program_id)}) SELECT seq FROM cl WHERE id = ${c.id}`);
  const g = c.closing_group_id ? await db.query.closingGroups.findFirst({ where: eq(schema.closingGroups.id, c.closing_group_id) }) : null;
  const rows = await payerRows(auth, sql`d.closing_member_id = ${c.id}`);
  const { rows: [due] } = await db.execute(sql`SELECT max(due_date) AS d FROM dues WHERE closing_member_id = ${c.id}`);
  return {
    closing: { id: c.id, seq: s?.seq || 0, name: c.display_name, regNo: c.registration_number || "", village: c.village || "", date: iso(c.closing_date),
      batchId: c.closing_group_id, batchName: g?.name || "", dueBy: iso(due?.d), programId: c.program_id, fatherName: c.father_name },
    rows, totals: rowTotals(rows),
  };
}

export async function agentBatch(auth, batchId) {
  needAgent(auth);
  const g = await db.query.closingGroups.findFirst({ where: eq(schema.closingGroups.id, batchId) });
  if (!g) throw notFound("क्लोजिंग समूह नहीं मिला");
  const p = await db.query.programs.findFirst({ where: eq(schema.programs.id, g.programId) });
  if (!p || p.adminId !== auth.adminId) throw forbidden();
  const rows = await payerRows(auth, sql`c.closing_group_id = ${g.id}`);
  const all = await agentClosings(auth, { programId: p.id });
  const closings = all.closings.filter((c) => c.batchId === g.id);
  const dueBy = closings.reduce((m, c) => (c.dueBy && (!m || c.dueBy > m) ? c.dueBy : m), null);
  return { batch: { id: g.id, name: g.name, closings: closings.length, dueBy, programId: p.id }, closings, rows, totals: rowTotals(rows) };
}

/** The agent's "new member" requests and what the office decided. */
export async function agentRequests(auth) {
  needAgent(auth);
  const { rows } = await db.execute(sql`
    SELECT m.*, p.name AS program_name, p.hiname AS program_hiname, m.extra->>'statusReason' AS reason
    FROM members m JOIN programs p ON p.id = m.program_id
    WHERE m.agent_id = ${auth.agentId} AND m.added_by = 'agent' AND NOT m.deleted AND m.status <> 'removed'
    ORDER BY m.created_at DESC LIMIT 500`);
  const st = (s) => (s === "pending" ? "pending" : s === "rejected" ? "rejected" : "approved");
  const requests = rows.map((m) => ({
    ...shapeMember(m), status: st(m.status), memberId: m.id, rejectReason: m.reason || "", createdAt: m.created_at,
    joinFees: m.join_fees, joinFeesCollected: m.join_fees_paid_amount, note: m.note,
  }));
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const r of requests) counts[r.status]++;
  return { requests, counts };
}

export async function agentRequestRow(auth, id) {
  needAgent(auth);
  const m = await memberRow(id);
  if (!m || m.agent_id !== auth.agentId) throw notFound("अनुरोध नहीं मिला");
  return m;
}

export async function agentCommission(auth, { programId } = {}) {
  needAgent(auth);
  const [summary, list, payouts] = await Promise.all([
    commissionSummary(auth.adminId, auth.agentId, { programId }),
    listCommissions(auth.adminId, auth.agentId, { programId, all: true }),
    listPayouts(auth.adminId, auth.agentId),
  ]);
  return { summary, entries: list.commissions, payouts };
}
