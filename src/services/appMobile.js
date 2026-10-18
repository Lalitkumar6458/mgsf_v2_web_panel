// The mobile app's API (agent / member) — composite payloads the app reads verbatim.
// Routes under /api/app/* are thin wrappers around the helpers here.
//
// Conventions:
//  - Responses are camelCase EXCEPT /api/app/session's `member` object, which the app reads in
//    snake_case (display_name, registration_number, agent_name, agent_phone).
//  - Dates are "YYYY-MM-DD" strings; *At fields keep an ISO/-sortable prefix.
//  - Money is integer rupees.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { camel } from "../lib/case.js";
import { appPalette } from "../lib/theme/themes.js";
import { getTrustProfile } from "./trust.js";
import { getReceiptSettings } from "./receiptSettings.js";
import { getTrustFeatures } from "./features.js";
import { upiLink } from "../lib/receiptSettings.js";
import { fmtISO } from "../lib/dates.js";

/** Today in India as "YYYY-MM-DD". */
export const todayISO = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const int = (v) => Number(v) || 0;
const inList = (ids) => sql`(${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`;

/* ── trust branding / theme / app settings ─────────────────────────────── */

async function appExtra(adminId) {
  const { rows: [r] } = await db.execute(sql`SELECT extra->'app' AS app, extra->'theme' AS theme FROM admins WHERE id = ${adminId}`);
  return { app: r?.app && typeof r.app === "object" ? r.app : {}, theme: r?.theme };
}

export async function brandingFor(adminId) {
  const t = await getTrustProfile(adminId, { inlineImages: false });
  return {
    name: t.name,
    shortName: t.shortName || t.name,
    logo: t.logo || null,
    cityState: t.cityState,
    address: t.address,
    contact: t.contact,
    email: t.email,
    topTitle: Array.isArray(t.topTitle) ? t.topTitle : [],
  };
}

/** Programs of the trust, with the fields the agent "new request" form needs. */
export async function programsFor(adminId, { agentId } = {}) {
  const { rows } = await db.execute(sql`
    SELECT p.id, p.name, p.hiname, p.is_selected, p.default_pay_amount, p.age_groups, p.location_groups,
      (SELECT count(*) FROM members m WHERE m.program_id = p.id AND NOT m.deleted
        ${agentId ? sql`AND m.agent_id = ${agentId}` : sql``})::int AS members
    FROM programs p WHERE p.admin_id = ${adminId}
    ORDER BY p.created_at`);
  return rows.map((r) => ({
    id: r.id, name: r.name, hiname: r.hiname, isSelected: r.is_selected,
    defaultPayAmount: r.default_pay_amount, ageGroups: r.age_groups || [], locationGroups: r.location_groups || [],
    members: r.members,
  }));
}

/* ── config / status / about / payment ─────────────────────────────────── */

export async function appConfig(auth) {
  const [branding, { theme }] = await Promise.all([brandingFor(auth.adminId), appExtra(auth.adminId)]);
  return { branding, palette: appPalette(theme) };
}

export async function appStatus(auth) {
  const [{ app }, settings] = await Promise.all([appExtra(auth.adminId), getReceiptSettings(auth.adminId)]);
  const s = app.status || app || {};
  const update = s.update || {};
  const payment = s.payment || {};
  const upiOn = !!settings.upiId;
  return {
    maintenance: {
      on: Boolean(s.maintenance?.on),
      message: String(s.maintenance?.message || ""),
      until: String(s.maintenance?.until || ""),
    },
    update: {
      latestVersion: String(update.latestVersion || process.env.APP_LATEST_VERSION || ""),
      minVersion: String(update.minVersion || process.env.APP_MIN_VERSION || ""),
      url: String(update.url || process.env.APP_UPDATE_URL || ""),
      message: String(update.message || ""),
    },
    payment: {
      members: payment.members !== undefined ? Boolean(payment.members) : upiOn,
      agents: payment.agents !== undefined ? Boolean(payment.agents) : upiOn,
    },
  };
}

const splitPhones = (s) => String(s || "").split(/[/,;]+/).map((x) => x.trim()).filter(Boolean);
const digits = (s) => String(s || "").replace(/\D/g, "");

export async function appAbout(auth) {
  const [t, { app }] = await Promise.all([getTrustProfile(auth.adminId, { inlineImages: false }), appExtra(auth.adminId)]);
  const override = app.about && typeof app.about === "object" ? app.about : {};
  const phones = Array.isArray(override.phones) ? override.phones : splitPhones(t.contact);
  const support0 = override.support && typeof override.support === "object" ? override.support : {};
  const about = {
    name: override.name || t.name,
    logo: override.logo || t.logo || null,
    cityState: override.cityState ?? t.cityState,
    address: override.address ?? t.address,
    topTitle: Array.isArray(override.topTitle) ? override.topTitle : (Array.isArray(t.topTitle) ? t.topTitle : []),
    aboutText: override.aboutText ?? t.about,
    regNo: override.regNo ?? t.regNo,
    govtRegNo: override.govtRegNo ?? t.govtRegNo,
    president: override.president ?? t.trustPresident,
    founder: override.founder ?? t.founder,
    contactPerson: override.contactPerson ?? t.contactPerson,
    website: override.website ?? t.website,
    phones,
    // `support` must always be an object (the Settings screen dereferences it unguarded)
    support: {
      phone: support0.phone ?? phones[0] ?? "",
      whatsapp: support0.whatsapp ?? digits(phones[0] || "") || "",
      email: support0.email ?? t.email,
      officeHours: support0.officeHours ?? "",
    },
  };
  return { about };
}

export async function appPayment(auth, { amount, note } = {}) {
  const [t, settings, { app }] = await Promise.all([
    getTrustProfile(auth.adminId, { inlineImages: false }),
    getReceiptSettings(auth.adminId),
    appExtra(auth.adminId),
  ]);
  const p = app.payment && typeof app.payment === "object" ? app.payment : {};
  const upiId = settings.upiId || "";
  const amt = Number(amount) || 0;
  const payeeName = p.payeeName || t.name;
  const link = upiId ? upiLink({ upiId, upiName: settings.upiName || t.name, amount: amt, note }) : "";
  let qrDataUrl = "";
  if (link && settings.showUpiQr !== false) {
    try {
      const QRCode = (await import("qrcode")).default;
      qrDataUrl = await QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 1, width: 340 });
    } catch { qrDataUrl = ""; }
  }
  return {
    payment: {
      payeeName,
      upiId,
      upiLink: link,
      qrDataUrl,
      qrImageURL: p.qrImageURL || "",
      confirmWhatsapp: p.confirmWhatsapp || digits(t.contact),
      note: p.note || (note ? String(note) : ""),
      steps: Array.isArray(p.steps) ? p.steps : [],
      bank: p.bank && typeof p.bank === "object" ? p.bank : null,
    },
  };
}

/* ── session ───────────────────────────────────────────────────────────── */

export async function sessionFor(auth) {
  const [{ theme, app }, branding, settings] = await Promise.all([
    appExtra(auth.adminId), brandingFor(auth.adminId), getReceiptSettings(auth.adminId),
  ]);
  const programs = await programsFor(auth.adminId);
  const out = {
    role: auth.role,
    user: { accountId: auth.accountId, displayName: auth.displayName, agentId: auth.agentId, memberId: auth.memberId },
    agent: null,
    member: null,
    programs: programs.map((p) => ({ id: p.id, name: p.name, hiname: p.hiname, is_selected: p.isSelected })),
    trust: { ...branding, ...(app.trust || {}) },
    palette: appPalette(theme),
    features: auth.features || {},
    upi: settings.upiId ? { id: settings.upiId, name: settings.upiName || "" } : null,
  };
  if (auth.agentId) {
    const a = await db.query.agents.findFirst({ where: (t, { eq }) => eq(t.id, auth.agentId) });
    if (a) out.agent = { id: a.id, displayName: a.displayName, phone: a.phone, email: a.email, photoUrl: a.photoUrl };
  }
  if (auth.memberId) {
    const { rows: [m] } = await db.execute(sql`
      SELECT m.*, a.display_name AS agent_name, a.phone AS agent_phone
      FROM members m LEFT JOIN agents a ON a.id = m.agent_id
      WHERE m.id = ${auth.memberId}`);
    if (m) out.member = m; // snake_case on purpose
  }
  return out;
}

/* ── member detail (also used by the agent member screen) ──────────────── */

function timing(paidDate, dueDate, today) {
  if (!paidDate) return { timing: null, lateByDays: 0, overdue: !!dueDate && dueDate < today, overdueDays: 0 };
  if (dueDate && paidDate > dueDate) {
    const late = Math.round((Date.parse(paidDate) - Date.parse(dueDate)) / 86400000);
    return { timing: "late", lateByDays: late, overdue: false, overdueDays: 0 };
  }
  return { timing: "onTime", lateByDays: 0, overdue: false, overdueDays: 0 };
}

/** One raw due row (camel) → the app's ClosingRow / timeline shape. */
export function toClosingRow(r, today) {
  const paidDate = r.paidDate ? fmtISO(r.paidDate) : (r.paidAt ? fmtISO(r.paidAt) : "");
  const dueBy = r.dueDate ? fmtISO(r.dueDate) : null;
  const paid = int(r.paidAmount);
  const amount = int(r.amount);
  const remaining = Math.max(amount - paid, 0);
  const t = timing(paidDate, dueBy, today);
  let overdue = t.overdue, overdueDays = t.overdueDays;
  if (remaining > 0 && dueBy && dueBy < today) {
    overdue = true;
    overdueDays = Math.round((Date.parse(today) - Date.parse(dueBy)) / 86400000);
  }
  return {
    id: r.id,
    closingId: r.closingId,
    seq: r.closingSeq ?? null,
    name: r.closingName || "",
    regNo: r.closingRegNo || "",
    date: r.closingDate ? fmtISO(r.closingDate) : null,
    village: r.closingVillage || "",
    batchId: r.closingGroupId || null,
    batchName: r.closingGroupName || null,
    remaining,
    paid,
    status: r.dueStatus,
    timing: t.timing,
    overdue,
    overdueDays,
    lateByDays: t.lateByDays,
    paidAt: paidDate || null,
    dueBy,
    receiptNo: r.receiptNo || "",
  };
}

const TIMELINE_SQL = (whereIds) => sql`
  SELECT d.id, d.amount, d.paid_amount, d.status::text AS due_status, d.due_date, d.paid_at, d.paid_date,
    c.id AS closing_id, c.member_number AS closing_seq, c.display_name AS closing_name,
    c.registration_number AS closing_reg_no, c.village AS closing_village, c.closing_date,
    c.closing_group_id, g.name AS closing_group_name, r.receipt_no
  FROM dues d
  JOIN members c ON c.id = d.closing_member_id
  LEFT JOIN closing_groups g ON g.id = c.closing_group_id
  LEFT JOIN LATERAL (
    SELECT rr.receipt_no FROM receipt_register rr
    WHERE rr.member_id = d.payer_member_id AND rr.due_ids ? d.id
    ORDER BY rr.created_at DESC LIMIT 1
  ) r ON true
  WHERE d.payer_member_id IN ${whereIds}
  ORDER BY c.closing_date DESC, d.id`;

const RECEIPT_SQL = (whereIds) => sql`
  SELECT t.payer_member_id, t.batch_id, min(t.created_at) AS created_at, max(t.payment_date) AS paid_at,
    sum(t.amount)::int AS total_amount, count(*)::int AS item_count,
    (array_agg(t.payment_method))[1] AS method,
    max(NULLIF(t.online_reference, '')) AS ref,
    json_agg(json_build_object('seq', c.member_number, 'name', c.display_name) ORDER BY t.sequence_number) AS items,
    array_agg(t.due_id) FILTER (WHERE t.due_id IS NOT NULL) AS due_ids
  FROM transactions t
  LEFT JOIN members c ON c.id = t.closing_member_id
  WHERE t.payer_member_id IN ${whereIds} AND t.status = 'completed'
  GROUP BY t.payer_member_id, t.batch_id
  ORDER BY paid_at DESC, created_at DESC`;

/** Timeline rows for a set of payer member ids, grouped by payer id. */
async function timelinesFor(payerIds, today) {
  const map = new Map(payerIds.map((id) => [id, []]));
  if (!payerIds.length) return map;
  const { rows } = await db.execute(TIMELINE_SQL(inList(payerIds)));
  for (const raw of camel(rows)) {
    const list = map.get(raw.payerMemberId) || map.get(raw.payer_member_id);
    const key = raw.payerMemberId ?? raw.payer_member_id;
    if (map.has(key)) map.get(key).push(toClosingRow(raw, today));
  }
  return map;
}

/** Receipt rows (closing batches + join-fee receipts) for a set of payers, grouped by payer id. */
async function receiptsFor(payerIds) {
  const map = new Map(payerIds.map((id) => [id, []]));
  if (!payerIds.length) return map;
  const { rows } = await db.execute(RECEIPT_SQL(inList(payerIds)));
  const regs = (await db.execute(sql`
    SELECT id, member_id, receipt_no, amount, due_ids FROM receipt_register WHERE member_id IN ${inList(payerIds)}`)).rows;
  const feeRows = (await db.execute(sql`
    SELECT id, member_id, amount, payment_mode, transaction_ref, payment_date, created_at
    FROM join_fee_payments WHERE member_id IN ${inList(payerIds)}
    ORDER BY payment_date DESC, created_at DESC`)).rows;

  const byMember = new Map();
  for (const r of regs) (byMember.get(r.member_id) || byMember.set(r.member_id, []).get(r.member_id)).push(r);

  for (const raw of camel(rows)) {
    const payer = raw.payerMemberId;
    const dueIds = Array.isArray(raw.dueIds) ? raw.dueIds : [];
    const reg = (byMember.get(payer) || []).find((x) => int(x.amount) === int(raw.totalAmount)
      && (Array.isArray(x.due_ids) ? x.due_ids : []).some((id) => dueIds.includes(id)));
    const list = map.get(payer) || [];
    list.push({
      id: raw.batchId,
      status: "completed",
      kind: "closing",
      receiptNo: reg?.receipt_no || "",
      paidAt: raw.paidAt ? fmtISO(raw.paidAt) : "",
      method: raw.method || "cash",
      itemCount: int(raw.itemCount),
      ref: raw.ref || "",
      totalAmount: int(raw.totalAmount),
      items: Array.isArray(raw.items) ? raw.items : [],
    });
    map.set(payer, list);
  }
  for (const f of feeRows) {
    const list = map.get(f.member_id);
    if (!list) continue;
    list.push({
      id: f.id,
      status: "completed",
      kind: "fee",
      receiptNo: "",
      paidAt: f.payment_date ? fmtISO(f.payment_date) : (f.created_at ? fmtISO(f.created_at) : ""),
      method: f.payment_mode || "cash",
      itemCount: 1,
      ref: f.transaction_ref || "",
      totalAmount: int(f.amount),
      items: [{ seq: "", name: "नामांकन शुल्क" }],
    });
  }
  return map;
}

function summarise(timeline, joinFee) {
  const s = {
    pendingAmount: 0, pendingCount: 0, paidAmount: 0, paidCount: 0,
    onTimeAmount: 0, onTimeCount: 0, lateCount: 0, overdueCount: 0, overdueAmount: 0, eligibleCount: 0,
  };
  for (const r of timeline) {
    s.eligibleCount += 1;
    s.paidAmount += r.paid;
    if (r.status === "paid") s.paidCount += 1;
    if (r.remaining > 0) { s.pendingAmount += r.remaining; s.pendingCount += 1; }
    if (r.timing === "onTime") { s.onTimeCount += 1; s.onTimeAmount += r.paid; }
    if (r.timing === "late") s.lateCount += 1;
    if (r.overdue && r.remaining > 0) { s.overdueCount += 1; s.overdueAmount += r.remaining; }
  }
  if (joinFee) {
    s.pendingAmount += joinFee.due || 0;
    s.paidAmount += joinFee.paid || 0;
  }
  return s;
}

const joinFeeOf = (m) => {
  const total = int(m.joinFees);
  const paid = int(m.joinFeesPaidAmount);
  return { total, paid, due: Math.max(total - paid, 0), done: !!m.joinFeesDone || (total > 0 && paid >= total) };
};

export async function memberDetail(auth, memberId) {
  const m = await db.query.members.findFirst({ where: (t, { eq }) => eq(t.id, memberId) });
  if (!m) return null;
  const today = todayISO();
  const [timelineMap, receiptMap, agent] = await Promise.all([
    timelinesFor([memberId], today),
    receiptsFor([memberId]),
    m.agentId ? db.query.agents.findFirst({ where: (t, { eq }) => eq(t.id, m.agentId) }) : null,
  ]);
  const timeline = timelineMap.get(memberId) || [];
  const joinFee = joinFeeOf(m);
  return {
    member: {
      id: m.id, displayName: m.displayName, registrationNumber: m.registrationNumber, photoUrl: m.photoUrl,
      fatherName: m.fatherName, guardian: m.guardian, guardianRelation: m.guardianRelation, status: m.status,
      programId: m.programId, programName: m.program?.name || "",
      phone: m.phone, phoneAlt: m.phoneAlt, aadhaarNo: m.aadhaarNo, jati: m.jati, gotra: m.gotra,
      birthDate: fmtISO(m.birthDate), dateJoin: fmtISO(m.dateJoin), closingDate: m.closingDate ? fmtISO(m.closingDate) : null,
      applicationNumber: m.applicationNumber, currentAddress: m.currentAddress, village: m.village,
      district: m.district, state: m.state, pinCode: m.pinCode, payAmount: int(m.payAmount),
      agentName: agent?.displayName || "", agentPhone: agent?.phone || "",
    },
    summary: summarise(timeline, joinFee),
    joinFee,
    timeline,
    receipts: receiptMap.get(memberId) || [],
    lastPaymentAt: timeline.map((r) => r.paidAt).filter(Boolean).sort().pop() || null,
    graceDays: m.program?.dueDays ?? 45,
  };
}

/* ── family (everyone on the member's mobile number) ───────────────────── */

export async function familyFor(auth, { programId } = {}) {
  if (!auth.memberId) return { programs: [], members: [] };
  const me = await db.query.members.findFirst({ where: (t, { eq }) => eq(t.id, auth.memberId) });
  if (!me) return { programs: [], members: [] };
  const phones = [me.phone, me.phoneAlt].map((p) => String(p || "").trim()).filter(Boolean);
  const today = todayISO();

  let rows = [];
  if (phones.length) {
    const { rows: fam } = await db.execute(sql`
      SELECT m.*, p.name AS program_name FROM members m
      JOIN programs p ON p.id = m.program_id
      WHERE p.admin_id = ${auth.adminId} AND NOT m.deleted
        AND m.status IN ('accepted', 'closed', 'pending')
        AND (m.phone IN ${inList(phones)} OR m.phone_alt IN ${inList(phones)})
        ${programId ? sql`AND m.program_id = ${programId}` : sql``}
      ORDER BY p.created_at, m.display_name`);
    rows = fam;
  }
  if (!rows.some((r) => r.id === me.id)) {
    const { rows: [self] } = await db.execute(sql`
      SELECT m.*, p.name AS program_name FROM members m JOIN programs p ON p.id = m.program_id
      WHERE m.id = ${me.id} ${programId ? sql`AND m.program_id = ${programId}` : sql``}`);
    if (self) rows = [self, ...rows];
  }
  const ids = rows.map((r) => r.id);
  const now = Date.now();
  const [timelineMap, receiptMap] = await Promise.all([timelinesFor(ids, today), receiptsFor(ids)]);

  const programs = [];
  const seen = new Set();
  const members = rows.map((m) => {
    if (!seen.has(m.program_id)) { seen.add(m.program_id); programs.push({ id: m.program_id, name: m.program_name }); }
    const timeline = timelineMap.get(m.id) || [];
    return {
      id: m.id, displayName: m.display_name, registrationNumber: m.registration_number,
      photoUrl: m.photo_url, programId: m.program_id, programName: m.program_name,
      status: m.blocked ? "blocked" : (m.status === "accepted" || m.status === "closed" ? m.status : "pending"),
      dueAmount: timeline.reduce((s, r) => s + r.remaining, 0),
      paidAmount: timeline.reduce((s, r) => s + r.paid, 0),
      dueCount: timeline.filter((r) => r.remaining > 0).length,
      joinFeesDue: Math.max(int(m.join_fees) - int(m.join_fees_paid_amount), 0),
      joinFee: { due: Math.max(int(m.join_fees) - int(m.join_fees_paid_amount), 0) },
      timeline,
      receipts: receiptMap.get(m.id) || [],
    };
  });
  void now;
  return { programs, members };
}

/* ── agent: overview / members / closings / batches / commission ───────── */

const agentProgram = async (auth, programId) => {
  if (programId) {
    const p = await db.query.programs.findFirst({ where: (t, { eq }) => eq(t.id, programId) });
    if (p && (auth.role === "owner" || p.adminId === auth.adminId)) return p;
  }
  const p = await db.query.programs.findFirst({
    where: (t, { eq, and }) => and(eq(t.adminId, auth.adminId), eq(t.isSelected, true)),
  });
  if (p) return p;
  return db.query.programs.findFirst({ where: (t, { eq }) => eq(t.adminId, auth.adminId) });
};

export async function agentOverview(auth, programId) {
  const programs = await programsFor(auth.adminId, { agentId: auth.agentId });
  const program = await agentProgram(auth, programId);
  const pid = program?.id || null;
  const agentId = auth.agentId;

  const empty = {
    programId: pid, programs, agent: null,
    current: { dueAmount: 0, withDue: 0, dueCount: 0, members: 0, paidAmount: 0, feeDue: 0, accepted: 0, closed: 0, blocked: 0, feePendingMembers: 0, feePaid: 0, feeTotal: 0 },
    requests: { pending: 0, approved: 0, rejected: 0 },
  };
  if (!pid) return empty;

  const { rows: [c] } = await db.execute(sql`
    WITH mine AS (SELECT id FROM members WHERE program_id = ${pid} AND NOT deleted ${agentId ? sql`AND agent_id = ${agentId}` : sql``}),
    d AS (SELECT * FROM dues WHERE payer_member_id IN (SELECT id FROM mine))
    SELECT
      (SELECT count(*) FROM mine)::int AS members,
      (SELECT count(*) FROM members WHERE id IN (SELECT id FROM mine) AND status = 'accepted')::int AS accepted,
      (SELECT count(*) FROM members WHERE id IN (SELECT id FROM mine) AND closing_date IS NOT NULL)::int AS closed,
      (SELECT count(*) FROM members WHERE id IN (SELECT id FROM mine) AND blocked)::int AS blocked,
      (SELECT COALESCE(sum(amount - paid_amount), 0) FROM d WHERE status <> 'paid')::int AS due_amount,
      (SELECT count(DISTINCT payer_member_id) FROM d WHERE status <> 'paid')::int AS with_due,
      (SELECT count(*) FROM d WHERE status <> 'paid')::int AS due_count,
      (SELECT COALESCE(sum(paid_amount), 0) FROM d)::int AS paid_amount,
      (SELECT COALESCE(sum(join_fees - join_fees_paid_amount), 0) FROM members WHERE id IN (SELECT id FROM mine))::int AS fee_due,
      (SELECT count(*) FROM members WHERE id IN (SELECT id FROM mine) AND join_fees - join_fees_paid_amount > 0)::int AS fee_pending_members,
      (SELECT COALESCE(sum(join_fees_paid_amount), 0) FROM members WHERE id IN (SELECT id FROM mine))::int AS fee_paid,
      (SELECT COALESCE(sum(join_fees), 0) FROM members WHERE id IN (SELECT id FROM mine))::int AS fee_total,
      (SELECT count(*) FROM members WHERE id IN (SELECT id FROM mine) AND status = 'pending')::int AS req_pending,
      (SELECT count(*) FROM members WHERE id IN (SELECT id FROM mine) AND status IN ('accepted', 'closed'))::int AS req_approved,
      (SELECT count(*) FROM members WHERE id IN (SELECT id FROM mine) AND status IN ('rejected', 'removed'))::int AS req_rejected`);

  const summary = await commissionSummarySafe(auth.adminId, agentId, pid);
  const a = agentId ? await db.query.agents.findFirst({ where: (t, { eq }) => eq(t.id, agentId) }) : null;

  return {
    programId: pid,
    programs,
    current: {
      dueAmount: int(c.due_amount), withDue: int(c.with_due), dueCount: int(c.due_count),
      members: int(c.members), paidAmount: int(c.paid_amount), feeDue: int(c.fee_due),
      accepted: int(c.accepted), closed: int(c.closed), blocked: int(c.blocked),
      feePendingMembers: int(c.fee_pending_members), feePaid: int(c.fee_paid), feeTotal: int(c.fee_total),
    },
    agent: {
      displayName: a?.displayName || auth.displayName || "",
      earnedTotal: int(summary.earned), paidTotal: int(summary.paid), dueTotal: int(summary.pending),
      collectedAmount: int(c.paid_amount),
    },
    requests: { pending: int(c.req_pending), approved: int(c.req_approved), rejected: int(c.req_rejected) },
  };
}

async function commissionSummarySafe(adminId, agentId, programId) {
  const { rows: [s] } = await db.execute(sql`
    SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'earned' AND status <> 'cancelled'), 0)::float8 AS earned,
           COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::float8 AS paid,
           COALESCE(sum(amount) FILTER (WHERE status = 'pending'), 0)::float8 AS pending
    FROM agent_commissions WHERE agent_id = ${agentId} ${programId ? sql`AND program_id = ${programId}` : sql``}`);
  return s || { earned: 0, paid: 0, pending: 0 };
}

const MEMBER_FILTERS = {
  all: sql``,
  due: sql`AND (SELECT COALESCE(sum(amount - paid_amount), 0) FROM dues WHERE payer_member_id = m.id AND status <> 'paid') > 0`,
  paid: sql`AND (SELECT COALESCE(sum(amount - paid_amount), 0) FROM dues WHERE payer_member_id = m.id AND status <> 'paid') = 0`,
  feeDue: sql`AND m.join_fees - m.join_fees_paid_amount > 0`,
  feeDone: sql`AND m.join_fees > 0 AND m.join_fees - m.join_fees_paid_amount <= 0`,
  active: sql`AND m.status = 'accepted' AND m.active AND NOT m.blocked`,
  closed: sql`AND m.closing_date IS NOT NULL`,
  blocked: sql`AND m.blocked`,
};

export async function agentMembers(auth, { programId, f = "all", q, page = 1, limit = 50 } = {}) {
  const size = Math.min(Math.max(int(limit) || 50, 1), 200);
  const pg = Math.max(int(page) || 1, 1);
  const offset = (pg - 1) * size;
  const like = q && String(q).trim().length >= 2 ? `%${String(q).trim()}%` : null;
  const filter = MEMBER_FILTERS[f] || sql``;
  const where = sql`
    m.program_id = ${programId} AND NOT m.deleted AND m.added_by IS NOT NULL
      ${auth.agentId ? sql`AND m.agent_id = ${auth.agentId}` : sql``}
      ${filter}
      ${like ? sql`AND (m.display_name ILIKE ${like} OR m.registration_number ILIKE ${like}
        OR m.application_number ILIKE ${like} OR m.phone ILIKE ${like} OR m.village ILIKE ${like})` : sql``}`;

  const { rows } = await db.execute(sql`
    SELECT m.id, m.display_name, m.registration_number, m.application_number, m.father_name, m.village,
      m.photo_url, m.status::text AS status, m.blocked, m.phone, m.join_fees, m.join_fees_paid_amount,
      COALESCE((SELECT sum(amount - paid_amount) FROM dues WHERE payer_member_id = m.id AND status <> 'paid'), 0)::int AS due_amount,
      COALESCE((SELECT count(*) FROM dues WHERE payer_member_id = m.id AND status <> 'paid'), 0)::int AS due_count,
      COALESCE((SELECT sum(paid_amount) FROM dues WHERE payer_member_id = m.id), 0)::int AS paid_amount,
      count(*) OVER()::int AS total_count
    FROM members m WHERE ${where}
    ORDER BY m.display_name
    LIMIT ${size} OFFSET ${offset}`);
  const { rows: [t] } = await db.execute(sql`
    SELECT COALESCE(sum(due_amount), 0)::int AS due_amount, COALESCE(sum(paid_amount), 0)::int AS paid_amount,
           COALESCE(sum(fee_due), 0)::int AS fee_due_amount, COALESCE(sum(fee_paid), 0)::int AS fee_paid_amount
    FROM (
      SELECT m.id,
        COALESCE((SELECT sum(amount - paid_amount) FROM dues WHERE payer_member_id = m.id AND status <> 'paid'), 0) AS due_amount,
        COALESCE((SELECT sum(paid_amount) FROM dues WHERE payer_member_id = m.id), 0) AS paid_amount,
        GREATEST(m.join_fees - m.join_fees_paid_amount, 0) AS fee_due,
        m.join_fees_paid_amount AS fee_paid
      FROM members m WHERE ${where}
    ) x`);
  const total = rows[0]?.total_count || 0;
  rows.forEach((r) => delete r.total_count);
  return {
    members: rows.map((m) => ({
      id: m.id, displayName: m.display_name, registrationNumber: m.registration_number,
      applicationNumber: m.application_number, fatherName: m.father_name, village: m.village,
      photoUrl: m.photo_url, status: m.blocked ? "blocked" : m.status, phone: m.phone,
      dueAmount: int(m.due_amount), dueCount: int(m.due_count), paidAmount: int(m.paid_amount),
      joinFeesDue: Math.max(int(m.join_fees) - int(m.join_fees_paid_amount), 0),
    })),
    totals: { dueAmount: int(t.due_amount), paidAmount: int(t.paid_amount), feeDueAmount: int(t.fee_due_amount), feePaidAmount: int(t.fee_paid_amount) },
    total, pages: Math.max(Math.ceil(total / size), 1), page: pg,
  };
}

export async function agentClosings(auth, programId) {
  const agentFilter = auth.agentId
    ? sql`AND d.payer_member_id IN (SELECT id FROM members WHERE agent_id = ${auth.agentId})`
    : sql``;
  const { rows } = await db.execute(sql`
    SELECT c.id, c.member_number AS seq, c.display_name, c.registration_number, c.village,
      c.closing_date, c.closing_group_id, g.name AS closing_group_name,
      (c.closing_date + p.due_days) AS due_by,
      count(d.id)::int AS members,
      count(d.id) FILTER (WHERE d.status = 'paid')::int AS paid_count,
      COALESCE(sum(d.paid_amount), 0)::int AS paid_amount,
      count(d.id) FILTER (WHERE d.status <> 'paid')::int AS pending_count,
      COALESCE(sum(d.amount - d.paid_amount) FILTER (WHERE d.status <> 'paid'), 0)::int AS pending_amount
    FROM members c
    JOIN programs p ON p.id = c.program_id
    LEFT JOIN closing_groups g ON g.id = c.closing_group_id
    LEFT JOIN dues d ON d.closing_member_id = c.id ${agentFilter}
    WHERE c.program_id = ${programId} AND c.closing_date IS NOT NULL AND NOT c.deleted
    GROUP BY c.id, g.name, p.due_days
    ORDER BY c.closing_date DESC, c.member_number DESC`);

  const closings = rows.map((r) => ({
    id: r.id, seq: r.seq, name: r.display_name, regNo: r.registration_number,
    batchId: r.closing_group_id || null, batchName: r.closing_group_name || null,
    date: r.closing_date ? fmtISO(r.closing_date) : null, village: r.village, dueBy: r.due_by ? fmtISO(r.due_by) : null,
    members: int(r.members), paidCount: int(r.paid_count), paidAmount: int(r.paid_amount),
    pendingCount: int(r.pending_count), pendingAmount: int(r.pending_amount),
  }));

  const batchMap = new Map();
  for (const c of closings) {
    const key = c.batchId || "_none";
    let b = batchMap.get(key);
    if (!b) {
      b = { id: key, name: c.batchName || "बिना समूह", closings: 0, dueBy: null, pendingAmount: 0, paidAmount: 0, pendingCount: 0, _closings: [] };
      batchMap.set(key, b);
    }
    b.closings += 1;
    b.pendingAmount += c.pendingAmount;
    b.paidAmount += c.paidAmount;
    b.pendingCount += c.pendingCount;
    if (c.dueBy && (!b.dueBy || c.dueBy > b.dueBy)) b.dueBy = c.dueBy;
    b._closings.push(c);
  }
  const batches = [...batchMap.values()].map(({ _closings, ...b }) => b);

  const { rows: [mc] } = await db.execute(sql`
    SELECT count(*)::int AS n FROM members WHERE program_id = ${programId} AND NOT deleted
      ${auth.agentId ? sql`AND agent_id = ${auth.agentId}` : sql``}`);

  const totals = closings.reduce((s, c) => {
    s.closings += 1; s.pendingCount += c.pendingCount; s.paidCount += c.paidCount;
    s.pendingAmount += c.pendingAmount; s.paidAmount += c.paidAmount;
    return s;
  }, { closings: 0, pendingCount: 0, paidCount: 0, pendingAmount: 0, paidAmount: 0 });

  return { closings, batches, totals, members: int(mc.n) };
}

/** Base query for one closing's dues (agent scope) with payer totals. */
async function closingDetailRows(closingId, agentId) {
  const { rows } = await db.execute(sql`
    SELECT d.id, d.amount, d.paid_amount, d.status::text AS status,
      p.id AS payer_id, p.display_name, p.registration_number, p.father_name, p.village, p.phone, p.photo_url,
      COALESCE((SELECT sum(amount - paid_amount) FROM dues WHERE payer_member_id = p.id AND status <> 'paid'), 0)::int AS total_due_amount,
      COALESCE((SELECT count(*) FROM dues WHERE payer_member_id = p.id AND status <> 'paid'), 0)::int AS total_due_count
    FROM dues d JOIN members p ON p.id = d.payer_member_id
    WHERE d.closing_member_id = ${closingId} ${agentId ? sql`AND p.agent_id = ${agentId}` : sql``}
    ORDER BY (d.status = 'paid'), p.display_name`);
  return rows;
}

export async function agentClosing(auth, closingId) {
  const { rows: [c] } = await db.execute(sql`
    SELECT c.member_number AS seq, c.display_name, c.registration_number, c.village, c.closing_date,
      c.closing_group_id, g.name AS closing_group_name, (c.closing_date + p.due_days) AS due_by
    FROM members c JOIN programs p ON p.id = c.program_id
    LEFT JOIN closing_groups g ON g.id = c.closing_group_id
    WHERE c.id = ${closingId}`);
  if (!c) return null;
  const rows = await closingDetailRows(closingId, auth.agentId);
  const mapped = rows.map((r) => ({
    id: r.payer_id, displayName: r.display_name, photoUrl: r.photo_url, registrationNumber: r.registration_number,
    fatherName: r.father_name, village: r.village, phone: r.phone,
    remaining: Math.max(int(r.amount) - int(r.paid_amount), 0), paid: int(r.paid_amount), status: r.status,
    totalDueAmount: int(r.total_due_amount), totalDueCount: int(r.total_due_count),
  }));
  const totals = mapped.reduce((s, r) => {
    s.amount += r.remaining + r.paid; s.paidAmount += r.paid; s.pendingAmount += r.remaining;
    s.members += 1; if (r.remaining > 0) s.pendingCount += 1; else s.paidCount += 1;
    return s;
  }, { amount: 0, paidAmount: 0, pendingAmount: 0, members: 0, pendingCount: 0, paidCount: 0 });
  return {
    closing: {
      seq: c.seq, name: c.display_name, regNo: c.registration_number,
      date: c.closing_date ? fmtISO(c.closing_date) : null, village: c.village,
      batchId: c.closing_group_id || null, batchName: c.closing_group_name || null, dueBy: c.due_by ? fmtISO(c.due_by) : null,
    },
    totals, rows: mapped,
  };
}

export async function agentBatch(auth, batchId) {
  const isNone = batchId === "_none";
  const { rows: [prog] } = await db.execute(sql`
    SELECT p.id, p.due_days FROM programs p
    WHERE p.admin_id = ${auth.adminId} ${isNone ? sql`AND p.id = (SELECT program_id FROM members WHERE closing_group_id IS NULL LIMIT 1)` : sql``}
    ORDER BY p.created_at LIMIT 1`);
  const { rows: [b] } = await db.execute(sql`
    SELECT g.id, g.name, g.program_id FROM closing_groups g
    WHERE ${isNone ? sql`false` : sql`g.id = ${batchId}`} AND g.program_id IN (SELECT id FROM programs WHERE admin_id = ${auth.adminId})`);
  const programId = b?.program_id || prog?.id;
  if (!programId) return { batch: { name: "बिना समूह", closings: 0, dueBy: null }, totals: { amount: 0, paidAmount: 0, pendingAmount: 0, members: 0, pendingMembers: 0, paidMembers: 0 }, rows: [], closings: [] };

  const groupCond = isNone ? sql`c.closing_group_id IS NULL` : sql`c.closing_group_id = ${batchId}`;
  const agentFilter = auth.agentId
    ? sql`AND d.payer_member_id IN (SELECT id FROM members WHERE agent_id = ${auth.agentId})`
    : sql``;

  const { rows: cl } = await db.execute(sql`
    SELECT c.id, c.member_number AS seq, c.display_name, c.registration_number, c.village, c.closing_date,
      c.closing_group_id, (c.closing_date + p.due_days) AS due_by,
      count(d.id)::int AS members,
      count(d.id) FILTER (WHERE d.status = 'paid')::int AS paid_count,
      COALESCE(sum(d.paid_amount), 0)::int AS paid_amount,
      count(d.id) FILTER (WHERE d.status <> 'paid')::int AS pending_count,
      COALESCE(sum(d.amount - d.paid_amount) FILTER (WHERE d.status <> 'paid'), 0)::int AS pending_amount
    FROM members c JOIN programs p ON p.id = c.program_id
    LEFT JOIN dues d ON d.closing_member_id = c.id ${agentFilter}
    WHERE c.program_id = ${programId} AND c.closing_date IS NOT NULL AND NOT c.deleted AND ${groupCond}
    GROUP BY c.id, p.due_days ORDER BY c.closing_date DESC`);
  const closings = cl.map((r) => ({
    id: r.id, seq: r.seq, name: r.display_name, regNo: r.registration_number,
    batchId: r.closing_group_id || null, batchName: b?.name || null,
    date: r.closing_date ? fmtISO(r.closing_date) : null, village: r.village, dueBy: r.due_by ? fmtISO(r.due_by) : null,
    members: int(r.members), paidCount: int(r.paid_count), paidAmount: int(r.paid_amount),
    pendingCount: int(r.pending_count), pendingAmount: int(r.pending_amount),
  }));

  const { rows } = await db.execute(sql`
    SELECT d.payer_member_id AS id, sum(d.amount)::int AS amount, sum(d.paid_amount)::int AS paid_amount,
      count(*)::int AS closings, count(*) FILTER (WHERE d.status <> 'paid')::int AS pending_closings
    FROM dues d
    WHERE d.closing_member_id IN (
      SELECT c.id FROM members c WHERE c.program_id = ${programId} AND c.closing_date IS NOT NULL AND NOT c.deleted AND ${groupCond})
      ${agentFilter}
    GROUP BY d.payer_member_id`);
  const ids = rows.map((r) => r.id);
  const payerInfo = ids.length ? (await db.execute(sql`
    SELECT id, display_name, registration_number, father_name, village, phone, photo_url FROM members WHERE id IN ${inList(ids)}`)).rows : [];
  const infoById = new Map(payerInfo.map((p) => [p.id, p]));
  const memberRows = rows.map((r) => {
    const p = infoById.get(r.id) || {};
    const remaining = int(r.amount) - int(r.paid_amount);
    return {
      id: r.id, displayName: p.display_name, registrationNumber: p.registration_number, fatherName: p.father_name,
      village: p.village, phone: p.phone, photoUrl: p.photo_url,
      remaining, paid: int(r.paid_amount), pendingClosings: int(r.pending_closings), closings: int(r.closings),
      totalDueAmount: (await0, remaining),
    };
  });

  const totals = memberRows.reduce((s, r) => {
    s.amount += r.remaining + r.paid; s.paidAmount += r.paid; s.pendingAmount += r.remaining;
    s.members += 1; if (r.remaining > 0) s.pendingMembers += 1; else s.paidMembers += 1;
    return s;
  }, { amount: 0, paidAmount: 0, pendingAmount: 0, members: 0, pendingMembers: 0, paidMembers: 0 });

  const dueBy = closings.reduce((m, c) => (c.dueBy && (!m || c.dueBy > m) ? c.dueBy : m), null);
  return {
    batch: { id: batchId, name: b?.name || "बिना समूह", closings: closings.length, dueBy },
    totals,
    rows: memberRows,
    closings,
  };
}

const await0 = 0;

export async function agentCommission(auth, programId) {
  const agentId = auth.agentId;
  if (!agentId) return { entries: [], payouts: [] };
  const { rows } = await db.execute(sql`
    SELECT c.id, c.source, c.kind, c.status, c.amount::float8 AS amount, c.base_amount, c.rate_type,
      c.rate_value::float8 AS rate_value, c.payment_date,
      m.display_name AS member_name, m.registration_number AS member_reg_no, cm.display_name AS closing_member_name
    FROM agent_commissions c
    LEFT JOIN members m ON m.id = c.member_id
    LEFT JOIN members cm ON cm.id = c.closing_member_id
    WHERE c.agent_id = ${agentId} ${programId ? sql`AND c.program_id = ${programId}` : sql``}
    ORDER BY c.payment_date DESC, c.created_at DESC LIMIT 1000`);
  const { rows: payouts } = await db.execute(sql`
    SELECT id, payout_number, amount::float8 AS amount, payment_mode, reference, note, payout_date,
      commission_count, status, revert_reason
    FROM agent_commission_payouts WHERE agent_id = ${agentId}
    ORDER BY payout_date DESC, created_at DESC LIMIT 500`);
  return {
    entries: rows.map((e) => ({
      id: e.id, status: e.status, source: e.source, kind: e.kind, amount: int(e.amount),
      baseAmount: int(e.base_amount), rateType: e.rate_type, rateValue: int(e.rate_value),
      paymentDate: e.payment_date ? fmtISO(e.payment_date) : null,
      memberName: e.member_name, memberRegNo: e.member_reg_no, closingMemberName: e.closing_member_name,
    })),
    payouts: payouts.map((p) => ({
      id: p.id, status: p.status, payoutNumber: p.payout_number, payoutDate: p.payout_date ? fmtISO(p.payout_date) : null,
      commissionCount: int(p.commission_count), paymentMode: p.payment_mode, amount: int(p.amount),
      revertReason: p.revert_reason, reference: p.reference,
    })),
  };
}

/* ── requests (agent's member requests) ────────────────────────────────── */

const reqStatus = (s) => (s === "pending" ? "pending" : s === "accepted" || s === "closed" ? "approved" : s === "rejected" || s === "removed" ? "rejected" : "pending");

export async function requestsList(auth) {
  const { rows } = await db.execute(sql`
    SELECT m.id, m.status::text AS status, m.display_name, m.photo_url, m.father_name, m.village,
      m.program_id, p.name AS program_name, m.created_at, m.registration_number, m.extra->>'statusReason' AS reject_reason,
      m.phone, m.phone_alt, m.birth_date, m.date_join, m.age_group_range, m.pay_amount, m.join_fees,
      m.join_fees_paid_amount, m.district, m.state, m.note
    FROM members m JOIN programs p ON p.id = m.program_id
    WHERE m.agent_id = ${auth.agentId} AND NOT m.deleted AND p.admin_id = ${auth.adminId}
    ORDER BY m.created_at DESC LIMIT 500`);
  const requests = rows.map((r) => ({
    id: r.id, status: reqStatus(r.status), displayName: r.display_name, photoUrl: r.photo_url,
    fatherName: r.father_name, village: r.village, programId: r.program_id, programName: r.program_name,
    createdAt: r.created_at, registrationNumber: r.registration_number, rejectReason: r.reject_reason,
    phone: r.phone, phoneAlt: r.phone_alt, birthDate: r.birth_date ? fmtISO(r.birth_date) : null,
    dateJoin: r.date_join ? fmtISO(r.date_join) : null, ageGroupRange: r.age_group_range,
    payAmount: int(r.pay_amount), joinFees: int(r.join_fees), joinFeesCollected: int(r.join_fees_paid_amount),
    district: r.district, state: r.state, note: r.note, memberId: r.id,
  }));
  const counts = requests.reduce((s, r) => { s[r.status] = (s[r.status] || 0) + 1; return s; }, { pending: 0, approved: 0, rejected: 0 });
  return { requests, counts };
}

export async function requestDetail(auth, id) {
  const { rows: [r] } = await db.execute(sql`
    SELECT m.*, p.name AS program_name FROM members m JOIN programs p ON p.id = m.program_id
    WHERE m.id = ${id} AND m.agent_id = ${auth.agentId} AND p.admin_id = ${auth.adminId}`);
  if (!r) return null;
  return {
    request: {
      ...camel(r),
      status: reqStatus(r.status),
      programId: r.program_id,
      birthDate: r.birth_date ? fmtISO(r.birth_date) : null,
      dateJoin: r.date_join ? fmtISO(r.date_join) : null,
      extraDetails: Array.isArray(r.extra_details) ? r.extra_details : [],
      joinFeesPaidAmount: int(r.join_fees_paid_amount),
    },
  };
}

/** Agent resubmits a rejected/pending request — back to pending with the corrected fields. */
export async function resubmitRequest(auth, id, body) {
  const { rows: [m] } = await db.execute(sql`
    SELECT m.id, m.status::text AS status, m.program_id FROM members m JOIN programs p ON p.id = m.program_id
    WHERE m.id = ${id} AND m.agent_id = ${auth.agentId} AND p.admin_id = ${auth.adminId} AND NOT m.deleted`);
  if (!m) return null;
  if (!["pending", "rejected"].includes(m.status)) return { success: false, error: "यह अनुरोध अब बदला नहीं जा सकता" };
  const { memberFields } = await import("./members.js");
  const f = memberFields(body);
  const cols = Object.keys(f);
  const set = cols.length
    ? sql`${sql.join(cols.map((c) => sql`${sql.raw(snake(c))} = ${f[c]}`), sql`, `)}, `
    : sql``;
  await db.execute(sql`
    UPDATE members SET ${set} status = 'pending', active = false, updated_at = now(),
      extra = COALESCE(extra, '{}'::jsonb) - 'statusReason' WHERE id = ${id}`);
  return { success: true };
}

export async function removeRequest(auth, id) {
  const { rowCount } = await db.execute(sql`
    UPDATE members m SET deleted = true, updated_at = now()
    FROM programs p
    WHERE m.id = ${id} AND m.agent_id = ${auth.agentId} AND p.id = m.program_id AND p.admin_id = ${auth.adminId}
      AND m.status IN ('pending', 'rejected')`);
  if (!rowCount) return null;
  return { success: true };
}

const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/* ── upload (base64 JSON from the app) ─────────────────────────────────── */

const DATA_EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };

export async function uploadBase64(auth, { data, folder = "members", name = "photo.jpg" } = {}) {
  const { badRequest } = await import("../lib/errors.js");
  const raw = String(data || "");
  const m = raw.match(/^data:([^;,]+);base64,(.*)$/s);
  const type = m ? m[1] : (name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  const b64 = m ? m[2] : raw;
  if (!b64) throw badRequest("data required");
  const buf = Buffer.from(b64, "base64");
  if (!DATA_EXT[type]) throw badRequest("Only JPG, PNG, WEBP, GIF or PDF allowed");
  const { saveUpload } = await import("../lib/storage.js");
  const file = { type, size: buf.length, arrayBuffer: async () => buf };
  const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, "") || "misc";
  return { success: true, url: await saveUpload(file, `${auth.adminId}/${safeFolder}`) };
}
