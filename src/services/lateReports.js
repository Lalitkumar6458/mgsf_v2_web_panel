// Payment timeliness reports: late payments, agent performance, one member's full payment history.
//
// Every due (one payer × one closing) falls in exactly one bucket:
//   on_time  paid, and fully paid on/before its due date
//   late     paid, but after the due date            (days_late = paid date − due date)
//   overdue  not fully paid and the due date has passed (days_late = today − due date)
//   not_due  not fully paid, still inside the payment period
// Due date = closing date (or the day it was recorded) + programs.due_days (45 by default).
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { notFound } from "../lib/errors.js";
import { toDate, todayIST, fmtISO } from "../lib/dates.js";
import { camel } from "../lib/case.js";

export const KINDS = ["on_time", "late", "overdue", "not_due"];

const today = () => fmtISO(todayIST());
const kindSql = (t) => sql`(CASE
  WHEN d.status = 'paid' AND COALESCE(d.paid_date, d.due_date) <= d.due_date THEN 'on_time'
  WHEN d.status = 'paid' THEN 'late'
  WHEN d.due_date < ${t}::date THEN 'overdue'
  ELSE 'not_due' END)`;
const daysLateSql = (t) => sql`(CASE
  WHEN d.status = 'paid' THEN GREATEST(COALESCE(d.paid_date, d.due_date) - d.due_date, 0)
  WHEN d.due_date < ${t}::date THEN ${t}::date - d.due_date
  ELSE 0 END)`;

function baseWhere(programId, f, t) {
  const q = f.q ? `%${String(f.q).trim()}%` : null;
  return sql`d.program_id = ${programId}
    ${f.agentId === "none" ? sql`AND p.agent_id IS NULL` : f.agentId ? sql`AND p.agent_id = ${f.agentId}` : sql``}
    ${f.payerId ? sql`AND d.payer_member_id = ${f.payerId}` : sql``}
    ${f.closingId ? sql`AND d.closing_member_id = ${f.closingId}` : sql``}
    ${f.closingGroupId ? sql`AND c.closing_group_id = ${f.closingGroupId}` : sql``}
    ${f.from ? sql`AND c.closing_date >= ${fmtISO(toDate(f.from))}::date` : sql``}
    ${f.to ? sql`AND c.closing_date <= ${fmtISO(toDate(f.to))}::date` : sql``}
    ${f.minDays ? sql`AND ${daysLateSql(t)} >= ${Number(f.minDays) || 0}` : sql``}
    ${q ? sql`AND (p.display_name ILIKE ${q} OR p.registration_number ILIKE ${q} OR p.phone ILIKE ${q}
            OR c.display_name ILIKE ${q} OR c.registration_number ILIKE ${q})` : sql``}`;
}

/**
 * Late / overdue / on-time list.
 * f: { kind: on_time|late|overdue|not_due|problem(late+overdue)|all, agentId, closingId, closingGroupId, from, to (closing date),
 *      q, minDays, sort: days|amount|due, page, pageSize, all }
 */
export async function latePayments(programId, f = {}) {
  const t = today();
  const where = baseWhere(programId, f, t);
  const kinds = f.kind === "problem" ? ["late", "overdue"] : KINDS.includes(f.kind) ? [f.kind] : null;
  const kindFilter = kinds ? sql`AND ${kindSql(t)} IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``;
  const size = f.all ? 100000 : f.limit ? Math.min(Math.max(Number(f.limit) || 1, 1), 5000) : Math.min(Math.max(Number(f.pageSize) || 50, 1), 500);
  const offset = f.all ? 0 : (Math.max(Number(f.page) || 1, 1) - 1) * size;
  const order = f.sort === "amount" ? sql`(d.amount - d.paid_amount) DESC, days_late DESC`
    : f.sort === "due" ? sql`d.due_date, p.display_name`
    : sql`days_late DESC, d.due_date`;

  const [{ rows }, { rows: [s] }] = await Promise.all([
    db.execute(sql`
      SELECT d.id, d.amount, d.paid_amount, d.status::text AS due_status, d.due_date, d.paid_date,
        ${kindSql(t)} AS kind, ${daysLateSql(t)} AS days_late,
        p.id AS payer_id, p.display_name AS payer_name, p.registration_number AS payer_reg_no, p.phone AS payer_phone,
        p.village AS payer_village, p.agent_id, COALESCE(a.display_name, '') AS agent_name,
        c.id AS closing_id, c.display_name AS closing_name, c.registration_number AS closing_reg_no, c.closing_date,
        COALESCE(g.name, '') AS closing_group,
        count(*) OVER()::int AS total_count
      FROM dues d
      JOIN members p ON p.id = d.payer_member_id
      JOIN members c ON c.id = d.closing_member_id
      LEFT JOIN agents a ON a.id = p.agent_id
      LEFT JOIN closing_groups g ON g.id = c.closing_group_id
      WHERE ${where} ${kindFilter}
      ORDER BY ${order}
      LIMIT ${size} OFFSET ${offset}`),
    db.execute(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE k = 'on_time')::int AS on_time,
        count(*) FILTER (WHERE k = 'late')::int AS late,
        count(*) FILTER (WHERE k = 'overdue')::int AS overdue,
        count(*) FILTER (WHERE k = 'not_due')::int AS not_due,
        COALESCE(sum(due_left) FILTER (WHERE k = 'overdue'), 0)::bigint AS overdue_amount,
        COALESCE(sum(paid) FILTER (WHERE k = 'late'), 0)::bigint AS late_amount,
        COALESCE(round(avg(dl) FILTER (WHERE k = 'late'), 1), 0)::float8 AS avg_late_days,
        COALESCE(max(dl) FILTER (WHERE k IN ('late', 'overdue')), 0)::int AS max_days
      FROM (
        SELECT ${kindSql(t)} AS k, ${daysLateSql(t)} AS dl, d.amount - d.paid_amount AS due_left, d.paid_amount AS paid
        FROM dues d JOIN members p ON p.id = d.payer_member_id JOIN members c ON c.id = d.closing_member_id
        WHERE ${where}
      ) x`),
  ]);
  const total = rows[0]?.total_count || 0;
  rows.forEach((r) => delete r.total_count);
  return { rows: camel(rows), total, page: Number(f.page) || 1, pageSize: size, summary: camel(s), today: t };
}

/**
 * Agent performance (members' dues, optional closing date range). Ranked by score:
 * 60% on-time rate (of matured dues) + 40% collection rate (of matured amount).
 */
export async function agentPerformance(programId, f = {}) {
  const t = today();
  const range = sql`
    ${f.from ? sql`AND c.closing_date >= ${fmtISO(toDate(f.from))}::date` : sql``}
    ${f.to ? sql`AND c.closing_date <= ${fmtISO(toDate(f.to))}::date` : sql``}`;
  const { rows } = await db.execute(sql`
    WITH x AS (
      SELECT p.agent_id, ${kindSql(t)} AS k, ${daysLateSql(t)} AS dl, d.amount, d.paid_amount
      FROM dues d JOIN members p ON p.id = d.payer_member_id JOIN members c ON c.id = d.closing_member_id
      WHERE d.program_id = ${programId} ${range}
    ),
    agg AS (
      SELECT agent_id, count(*)::int AS dues,
        sum(amount)::bigint AS billed, sum(paid_amount)::bigint AS collected,
        count(*) FILTER (WHERE k = 'on_time')::int AS on_time,
        count(*) FILTER (WHERE k = 'late')::int AS late,
        count(*) FILTER (WHERE k = 'overdue')::int AS overdue,
        count(*) FILTER (WHERE k = 'not_due')::int AS not_due,
        COALESCE(sum(amount - paid_amount) FILTER (WHERE k = 'overdue'), 0)::bigint AS overdue_amount,
        COALESCE(round(avg(dl) FILTER (WHERE k = 'late'), 1), 0)::float8 AS avg_late_days,
        COALESCE(sum(amount) FILTER (WHERE k <> 'not_due'), 0)::bigint AS matured_billed,
        COALESCE(sum(paid_amount) FILTER (WHERE k <> 'not_due'), 0)::bigint AS matured_collected
      FROM x GROUP BY agent_id
    ),
    mem AS (
      SELECT agent_id, count(*) FILTER (WHERE status IN ('accepted', 'closed') AND NOT deleted)::int AS members,
        count(*) FILTER (WHERE status = 'accepted' AND active AND NOT blocked AND NOT deleted AND closing_date IS NULL)::int AS active_members
      FROM members WHERE program_id = ${programId} GROUP BY agent_id
    ),
    com AS (
      SELECT agent_id,
        COALESCE(sum(amount) FILTER (WHERE kind = 'earned' AND status <> 'cancelled'), 0)::float8 AS commission_earned,
        COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::float8 AS commission_paid,
        COALESCE(sum(amount) FILTER (WHERE status = 'pending'), 0)::float8 AS commission_pending
      FROM agent_commissions WHERE program_id = ${programId} GROUP BY agent_id
    )
    SELECT COALESCE(agg.agent_id, mem.agent_id) AS agent_id, COALESCE(a.display_name, 'Admin (no agent)') AS agent_name,
      a.phone AS agent_phone, COALESCE(mem.members, 0) AS members, COALESCE(mem.active_members, 0) AS active_members,
      COALESCE(agg.dues, 0) AS dues, COALESCE(agg.billed, 0) AS billed, COALESCE(agg.collected, 0) AS collected,
      COALESCE(agg.on_time, 0) AS on_time, COALESCE(agg.late, 0) AS late, COALESCE(agg.overdue, 0) AS overdue,
      COALESCE(agg.not_due, 0) AS not_due, COALESCE(agg.overdue_amount, 0) AS overdue_amount,
      COALESCE(agg.avg_late_days, 0) AS avg_late_days,
      COALESCE(agg.matured_billed, 0) AS matured_billed, COALESCE(agg.matured_collected, 0) AS matured_collected,
      COALESCE(com.commission_earned, 0) AS commission_earned, COALESCE(com.commission_paid, 0) AS commission_paid,
      COALESCE(com.commission_pending, 0) AS commission_pending
    FROM agg
    FULL JOIN mem ON COALESCE(mem.agent_id, '') = COALESCE(agg.agent_id, '')
    LEFT JOIN agents a ON a.id = COALESCE(agg.agent_id, mem.agent_id)
    LEFT JOIN com ON com.agent_id = COALESCE(agg.agent_id, mem.agent_id)
    WHERE COALESCE(a.deleted, false) = false`);

  const list = camel(rows).map((r) => {
    for (const k of ["billed", "collected", "overdueAmount", "maturedBilled", "maturedCollected"]) r[k] = Number(r[k]);
    const matured = r.onTime + r.late + r.overdue;
    r.onTimeRate = matured ? Math.round((r.onTime / matured) * 1000) / 10 : 0;
    r.collectionRate = r.maturedBilled ? Math.round((r.maturedCollected / r.maturedBilled) * 1000) / 10 : 0;
    r.score = matured ? Math.round((r.onTimeRate * 0.6 + r.collectionRate * 0.4) * 10) / 10 : 0;
    return r;
  });
  list.sort((a, b) => b.score - a.score || b.collected - a.collected);
  list.forEach((r, i) => { r.rank = r.dues ? i + 1 : null; });
  const totals = list.reduce((s, r) => {
    for (const k of ["members", "dues", "billed", "collected", "onTime", "late", "overdue", "notDue", "overdueAmount", "commissionEarned", "commissionPaid", "commissionPending"]) s[k] = (s[k] || 0) + Number(r[k] || 0);
    return s;
  }, {});
  return { agents: list, totals, today: t };
}

/** One member: every closing he owes / owed with due date, paid date, days late, transactions. */
export async function memberPaymentHistory(memberId) {
  const t = today();
  const { rows: [m] } = await db.execute(sql`
    SELECT m.id, m.program_id, m.display_name, m.father_name, m.registration_number, m.phone, m.village, m.date_join,
      m.pay_amount, m.status::text AS status, m.closing_date, COALESCE(a.display_name, '') AS agent_name, pr.name AS program_name
    FROM members m LEFT JOIN agents a ON a.id = m.agent_id LEFT JOIN programs pr ON pr.id = m.program_id
    WHERE m.id = ${memberId}`);
  if (!m) throw notFound("Member not found");
  const { rows } = await db.execute(sql`
    SELECT d.id, d.amount, d.paid_amount, d.status::text AS due_status, d.due_date, d.paid_date,
      ${kindSql(t)} AS kind, ${daysLateSql(t)} AS days_late,
      c.id AS closing_id, c.display_name AS closing_name, c.registration_number AS closing_reg_no, c.closing_date,
      COALESCE(g.name, '') AS closing_group,
      tx.payments
    FROM dues d
    JOIN members c ON c.id = d.closing_member_id
    LEFT JOIN closing_groups g ON g.id = c.closing_group_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('no', t.transaction_number, 'date', t.payment_date, 'amount', t.amount,
        'method', t.payment_method, 'ref', t.online_reference) ORDER BY t.payment_date) AS payments
      FROM transactions t WHERE t.due_id = d.id AND t.status = 'completed'
    ) tx ON true
    WHERE d.payer_member_id = ${memberId}
    ORDER BY c.closing_date DESC`);
  const list = camel(rows);
  const summary = list.reduce((s, r) => {
    s.total += 1; s[r.kind] += 1; s.billed += r.amount; s.paid += r.paidAmount;
    if (r.kind === "late") { s.lateDaysSum += r.daysLate; }
    if (r.kind === "overdue" || r.kind === "not_due") s.pendingAmount += r.amount - r.paidAmount;
    if (r.kind === "late" || r.kind === "overdue") s.maxDays = Math.max(s.maxDays, r.daysLate);
    return s;
  }, { total: 0, on_time: 0, late: 0, overdue: 0, not_due: 0, billed: 0, paid: 0, pendingAmount: 0, lateDaysSum: 0, maxDays: 0 });
  summary.avgLateDays = summary.late ? Math.round((summary.lateDaysSum / summary.late) * 10) / 10 : 0;
  const matured = summary.on_time + summary.late + summary.overdue;
  summary.onTimeRate = matured ? Math.round((summary.on_time / matured) * 1000) / 10 : 0;
  delete summary.lateDaysSum;
  return { member: camel(m), rows: list, summary: camel(summary), today: t };
}
