// Reports. What took a 1 GiB Cloud Function + thousands of Firestore reads
// is now one or two SQL queries.
import { advanceBalance } from "./advances.js";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { fmtDMY } from "../lib/dates.js";
import { camel } from "../lib/case.js";

const pick = (...v) => v.find((x) => x && x !== "NA" && x !== "N/A") || "";

/**
 * Per-agent member × closing report. Same response shape as the old
 * getAgentMarriagePaymentReport (compact=true → {report, closings, summary, agentInfo}).
 */
export async function agentReport(programId, agentId, { closingGroupId, compact = true } = {}) {
  const { rows: memberRows } = await db.execute(sql`
    SELECT m.id AS "memberId", m.display_name AS "displayName", m.father_name AS "fatherName",
           m.registration_number AS "registrationNumber", m.application_number AS "applicationNumber",
           m.phone, m.photo_url AS "photoURL", m.pay_amount AS "payAmount", m.added_by_name AS "addedByName",
           m.village, m.state, m.district, m.guardian, m.guardian_relation AS "guardianRelation"
    FROM members m
    WHERE m.program_id = ${programId} AND m.agent_id = ${agentId} AND NOT m.deleted AND m.active`);

  const { rows: dueRows } = await db.execute(sql`
    SELECT d.id AS "paymentId", d.payer_member_id, d.closing_member_id AS "closingMemberId",
           d.status::text AS status, d.amount, d.paid_amount
    FROM dues d
    JOIN members m ON m.id = d.payer_member_id
    ${closingGroupId ? sql`JOIN members c ON c.id = d.closing_member_id AND c.closing_group_id = ${closingGroupId}` : sql``}
    WHERE m.program_id = ${programId} AND m.agent_id = ${agentId} AND NOT m.deleted AND m.active`);

  const closingIds = [...new Set(dueRows.map((d) => d.closingMemberId))];
  const closings = {};
  if (closingIds.length) {
    const { rows } = await db.execute(sql`
      SELECT id, display_name, registration_number, application_number, father_name, jati, village, state,
             phone, guardian, guardian_relation, closing_date
      FROM members WHERE id IN (${sql.join(closingIds.map((x) => sql`${x}`), sql`, `)})`);
    for (const c of rows) {
      closings[c.id] = {
        closingMemberName: pick(c.display_name),
        closingRegNo: pick(c.registration_number) || "NA",
        closingApplicationNumber: pick(c.application_number) || "NA",
        closingFatherName: pick(c.father_name) || "NA",
        closingJati: pick(c.jati) || "NA",
        closingVillage: pick(c.village) || "NA",
        closingState: pick(c.state),
        closingPhone: pick(c.phone) || "NA",
        closingGuardian: pick(c.guardian),
        closingGuardianRelation: pick(c.guardian_relation),
        marriageDate: fmtDMY(c.closing_date),
        paymentFor: pick(c.display_name) || "Marriage Case",
      };
    }
  }

  const map = new Map(memberRows.map((m) => [m.memberId, {
    ...m,
    marriages: [],
    summary: { totalMarriages: 0, pendingMarriages: 0, paidMarriages: 0, pendingAmount: 0, paidAmount: 0 },
  }]));
  const totals = { totalPending: 0, totalPaid: 0, totalPendingAmount: 0, totalPaidAmount: 0 };

  for (const d of dueRows) {
    const m = map.get(d.payer_member_id);
    if (!m) continue;
    // old data model only knew pending/paid; a partial due counts as pending for the open part
    const status = d.status === "paid" ? "paid" : "pending";
    const amount = d.amount;
    m.marriages.push({ paymentId: d.paymentId, closingMemberId: d.closingMemberId, status, amount, paidAmount: d.paid_amount });
    m.summary.totalMarriages++;
    if (status === "paid") {
      m.summary.paidMarriages++; m.summary.paidAmount += amount; totals.totalPaid++; totals.totalPaidAmount += amount;
    } else {
      const open = amount - d.paid_amount;
      m.summary.pendingMarriages++; m.summary.pendingAmount += open; totals.totalPending++; totals.totalPendingAmount += open;
      m.summary.paidAmount += d.paid_amount; totals.totalPaidAmount += d.paid_amount;
    }
  }

  const report = [];
  for (const m of map.values()) {
    m.marriages.sort((a, b) => (a.status === b.status ? 0 : a.status === "pending" ? -1 : 1));
    if (!compact) {
      m.marriages = m.marriages.map((x) => ({ ...x, payerMemberId: m.memberId, ...(closings[x.closingMemberId] || {}) }));
    }
    m.totalAmount = m.summary.pendingAmount + m.summary.paidAmount;
    report.push(m);
  }
  report.sort((a, b) => b.summary.pendingAmount - a.summary.pendingAmount || b.summary.totalMarriages - a.summary.totalMarriages);

  return {
    success: true,
    compact,
    report,
    ...(compact ? { closings } : {}),
    summary: {
      totalMembers: memberRows.length,
      ...totals,
      totalAmount: totals.totalPendingAmount + totals.totalPaidAmount,
    },
    agentInfo: { agentId, agentName: memberRows[0]?.addedByName || "Unknown" },
  };
}

/** All dues of one member (as payer) with closing details — member app / Payment Details drawer. */
export async function memberDues(memberId, { status } = {}) {
  const { rows } = await db.execute(sql`
    SELECT d.id, d.status::text AS status, d.amount, d.paid_amount, d.due_date, d.added_manually, d.paid_at,
           d.closing_member_id, c.display_name AS closing_member_name, c.father_name AS closing_father_name,
           c.registration_number AS closing_reg_no, c.application_number AS closing_application_number,
           c.village AS closing_village, c.guardian AS closing_guardian, c.guardian_relation AS closing_guardian_relation,
           c.closing_date, c.closing_group_id
    FROM dues d JOIN members c ON c.id = d.closing_member_id
    WHERE d.payer_member_id = ${memberId}
      ${status ? sql`AND d.status = ${status}::due_status` : sql``}
    ORDER BY (d.status = 'paid'), c.closing_date`);
  const summary = rows.reduce((s, d) => {
    s.total++; s.totalAmount += d.amount; s.paidAmount += d.paid_amount;
    if (d.status === "paid") s.paid++; else s.pending++;
    return s;
  }, { total: 0, paid: 0, pending: 0, totalAmount: 0, paidAmount: 0 });
  summary.pendingAmount = summary.totalAmount - summary.paidAmount;
  summary.advance = await advanceBalance(memberId); // अग्रिम jama
  const { rows: [lim] } = await db.execute(sql`SELECT fixed_limit FROM members WHERE id = ${memberId}`);
  summary.fixedLimit = lim?.fixed_limit ?? null; // fixed rakam (null = no limit)
  summary.limitLeft = summary.fixedLimit == null ? null : Math.max(summary.fixedLimit - summary.paidAmount, 0);
  return { dues: camel(rows), summary };
}

/** Dashboard numbers for one program (replaces stored memberCount / inactivemembercount counters). */
export async function programDashboard(programId, { agentId } = {}) {
  const agentFilter = agentId ? sql`AND m.agent_id = ${agentId}` : sql``;
  const { rows: [counts] } = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE NOT m.deleted)::int                                                      AS total,
      count(*) FILTER (WHERE NOT m.deleted AND m.status = 'accepted' AND m.active AND NOT m.blocked)::int AS active,
      count(*) FILTER (WHERE NOT m.deleted AND (NOT m.active OR m.blocked))::int                      AS inactive,
      count(*) FILTER (WHERE NOT m.deleted AND m.status = 'pending')::int                             AS pending_requests,
      count(*) FILTER (WHERE NOT m.deleted AND m.closing_date IS NOT NULL)::int                       AS closed
    FROM members m WHERE m.program_id = ${programId} ${agentFilter}`);
  const { rows: [money] } = await db.execute(sql`
    SELECT COALESCE(sum(d.paid_amount), 0)::int AS collected,
           COALESCE(sum(d.amount - d.paid_amount), 0)::int AS outstanding,
           count(*) FILTER (WHERE d.status <> 'paid')::int AS open_dues
    FROM dues d JOIN members m ON m.id = d.payer_member_id
    WHERE d.program_id = ${programId} ${agentFilter}`);
  return { members: camel(counts), payments: camel(money) };
}

/**
 * Agent → "All Payment Status" (old /api/all-payment-status, same response shape).
 * rows: every active member of the agent with his paid / pending totals as payer;
 * closedRows: the agent's members whose own closing happened, with what was collected FOR them.
 */
export async function agentPaymentStatus(programId, agentId, { groupId } = {}) {
  const { rows: [prog] } = await db.execute(sql`SELECT name FROM programs WHERE id = ${programId}`);
  const programName = prog?.name || programId;

  const { rows: members } = await db.execute(sql`
    SELECT m.id, m.registration_number, m.display_name, m.father_name, m.phone, m.village, m.application_number,
           m.guardian, m.guardian_relation, m.district, m.state, m.closing_date, g.name AS closing_group_name,
           COALESCE(sum(d.paid_amount) FILTER (WHERE d.id IS NOT NULL), 0)::int                    AS total_paid,
           COALESCE(sum(d.amount - d.paid_amount) FILTER (WHERE d.status <> 'paid'), 0)::int      AS total_pending,
           count(d.id) FILTER (WHERE d.status = 'paid')::int                                      AS paid_count,
           count(d.id) FILTER (WHERE d.status <> 'paid')::int                                     AS pending_count
    FROM members m
    LEFT JOIN closing_groups g ON g.id = m.closing_group_id
    LEFT JOIN dues d ON d.payer_member_id = m.id
      ${groupId ? sql`AND d.closing_member_id IN (SELECT id FROM members WHERE closing_group_id = ${groupId})` : sql``}
    WHERE m.program_id = ${programId} AND m.agent_id = ${agentId}
      AND NOT m.deleted AND m.active AND NOT m.blocked AND m.status IN ('accepted', 'closed')
    GROUP BY m.id, g.name
    ORDER BY m.display_name`);

  const rows = members.map((m, i) => ({
    index: i + 1,
    memberId: m.id,
    registrationNumber: m.registration_number,
    memberName: m.display_name,
    fatherName: m.father_name,
    phone: m.phone,
    village: m.village,
    applicationNumber: m.application_number || "",
    guardian: m.guardian || "",
    guardianRelation: m.guardian_relation || "",
    district: m.district || "",
    state: m.state || "",
    programName,
    programId,
    totalPaid: m.total_paid,
    totalPending: m.total_pending,
    paidCount: m.paid_count,
    pendingCount: m.pending_count,
    isClosed: !!m.closing_date,
    closingDate: fmtDMY(m.closing_date),
    closingDateQuery: m.closing_date || "",
    closingGroupName: m.closing_group_name || "",
    status: m.paid_count > 0 && m.pending_count > 0 ? "both" : m.paid_count > 0 ? "paid" : m.pending_count > 0 ? "pending" : "none",
  }));

  const closed = rows.filter((r) => r.isClosed);
  if (closed.length) {
    const { rows: agg } = await db.execute(sql`
      SELECT closing_member_id,
             COALESCE(sum(paid_amount), 0)::int AS collected,
             COALESCE(sum(amount - paid_amount) FILTER (WHERE status <> 'paid'), 0)::int AS due,
             count(*) FILTER (WHERE status = 'paid')::int AS paid_count,
             count(*) FILTER (WHERE status <> 'paid')::int AS pending_count
      FROM dues WHERE closing_member_id IN (${sql.join(closed.map((r) => sql`${r.memberId}`), sql`, `)})
      GROUP BY closing_member_id`);
    const by = Object.fromEntries(agg.map((a) => [a.closing_member_id, a]));
    for (const r of closed) {
      const a = by[r.memberId] || { collected: 0, due: 0, paid_count: 0, pending_count: 0 };
      r.collectedForMember = a.collected;
      r.dueForMember = a.due;
      r.contributorsPaid = a.paid_count;
      r.contributorsPending = a.pending_count;
      r.contributorsTotal = a.paid_count + a.pending_count;
    }
  }

  const { rows: groups } = await db.execute(sql`
    SELECT g.id, g.name, count(m.id)::int AS member_count
    FROM closing_groups g LEFT JOIN members m ON m.closing_group_id = g.id AND NOT m.deleted
    WHERE g.program_id = ${programId} GROUP BY g.id ORDER BY g.created_at`);

  return {
    rows,
    closedRows: closed.map((r, i) => ({ ...r, index: i + 1 })),
    closingGroups: groups.map((g) => ({ id: g.id, name: g.name, memberCount: g.member_count })),
    programName,
    total: rows.length,
    totalClosed: closed.length,
  };
}

/**
 * Receipts (रसीद) data straight from the DB — no big upload from the browser.
 * One entry per payer with the closings he paid / still owes, in the shape VivahMemoPDF wants.
 * Filters: agent (payer's agent, "none" = admin), closing group ("none" = no group),
 * closing date range, explicit payer ids. status: "pending" (not fully paid) | "paid".
 */
function receiptWhere(programId, { status = "pending", agentId, closingGroupId, from, to, memberIds } = {}) {
  const want = status === "paid" ? sql`d.status = 'paid'` : sql`d.status <> 'paid'`;
  const ids = Array.isArray(memberIds) ? memberIds.filter(Boolean).map(String).slice(0, 20000) : null;
  return sql`d.program_id = ${programId} AND ${want} AND NOT p.deleted
      ${agentId === "none" ? sql`AND p.agent_id IS NULL` : agentId ? sql`AND p.agent_id = ${agentId}` : sql``}
      ${ids ? (ids.length ? sql`AND p.id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})` : sql`AND false`) : sql``}
      ${closingGroupId === "none" ? sql`AND c.closing_group_id IS NULL` : closingGroupId ? sql`AND c.closing_group_id = ${closingGroupId}` : sql``}
      ${from ? sql`AND c.closing_date >= ${from}::date` : sql``}
      ${to ? sql`AND c.closing_date <= ${to}::date` : sql``}`;
}

/** How big a receipts run would be, without loading it: { members, rows, pages } (10 rows per page) */
export async function receiptEstimate(programId, opts = {}) {
  const { rows: [r] } = await db.execute(sql`
    SELECT count(*)::int AS members, COALESCE(sum(n), 0)::int AS rows, COALESCE(sum(GREATEST(1, ceil(n / 10.0))), 0)::int AS pages
    FROM (
      SELECT d.payer_member_id, count(*) AS n
      FROM dues d JOIN members p ON p.id = d.payer_member_id JOIN members c ON c.id = d.closing_member_id
      WHERE ${receiptWhere(programId, opts)}
      GROUP BY d.payer_member_id
    ) x`);
  return r;
}

export async function receiptMembers(programId, opts = {}) {
  const { status = "pending" } = opts;
  const { rows } = await db.execute(sql`
    SELECT p.id AS pid, p.registration_number AS p_reg, p.application_number AS p_app, p.display_name AS p_name,
           p.father_name AS p_father, p.phone AS p_phone, p.pay_amount AS p_kist, p.guardian AS p_guardian,
           p.guardian_relation AS p_guardian_rel, p.current_address AS p_address, p.village AS p_village,
           p.district AS p_district, p.state AS p_state, p.agent_id AS p_agent, a.display_name AS agent_name, a.phone AS agent_phone,
           d.id AS due_id, d.amount, d.paid_amount,
           c.display_name AS c_name, c.registration_number AS c_reg, c.father_name AS c_father, c.village AS c_village,
           c.state AS c_state, c.guardian AS c_guardian, c.guardian_relation AS c_guardian_rel, c.phone AS c_phone, c.closing_date
    FROM dues d
    JOIN members p ON p.id = d.payer_member_id
    JOIN members c ON c.id = d.closing_member_id
    LEFT JOIN agents a ON a.id = p.agent_id
    WHERE ${receiptWhere(programId, opts)}
    ORDER BY a.display_name NULLS FIRST, p.agent_id NULLS FIRST,
             substring(p.application_number from '^[0-9]+')::bigint NULLS LAST, p.registration_number, p.id,
             c.closing_date, c.display_name`);

  const out = [];
  let cur = null;
  for (const r of rows) {
    if (!cur || cur.memberId !== r.pid) {
      cur = {
        memberId: r.pid, registrationNumber: r.p_reg, applicationNumber: r.p_app || "", displayName: r.p_name,
        fatherName: r.p_father || "", phone: r.p_phone || "", payAmount: r.p_kist, guardian: r.p_guardian || "",
        guardianRelation: r.p_guardian_rel || "", currentAddress: r.p_address || "", village: r.p_village || "",
        district: r.p_district || "", state: r.p_state || "", agentId: r.p_agent, agentName: r.agent_name || "Admin",
        agentPhone: r.agent_phone || "", marriages: [],
      };
      out.push(cur);
    }
    cur.marriages.push({
      paymentId: r.due_id, status: status === "paid" ? "paid" : "pending",
      amount: status === "paid" ? r.amount : r.amount - r.paid_amount,
      closingMemberName: pick(r.c_name), closingRegNo: pick(r.c_reg) || "NA", closingFatherName: pick(r.c_father),
      closingVillage: pick(r.c_village), closingState: pick(r.c_state), closingGuardian: pick(r.c_guardian),
      closingGuardianRelation: pick(r.c_guardian_rel), closingPhone: pick(r.c_phone) || "-",
      marriageDate: fmtDMY(r.closing_date),
    });
  }
  return out;
}
