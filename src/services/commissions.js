// Agent commission ledger.
//  - accrue*  : called inside the payment's own DB transaction, right after the payment rows are written.
//               One INSERT … SELECT for the whole batch; the rate is copied onto the row, so changing an
//               agent's rate later never changes old history. ON CONFLICT DO NOTHING → safe to run twice.
//  - cancel*  : a payment was undone. Unpaid commission → "cancelled". Commission already paid to the agent →
//               a negative "reversal" row, which is taken off his next payout.
//  - payouts  : admin pays the agent; chosen pending rows become "paid" and point to the payout.
//               Reverting a payout puts its rows back to pending.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { toDate, todayIST, fmtISO } from "../lib/dates.js";
import { camel } from "../lib/case.js";
import { COMMISSION_SOURCE, DEFAULT_CLOSING_PERCENT, DEFAULT_JOIN_FEES_PERCENT } from "../lib/commission.js";

const MODES = new Set(["cash", "online", "upi", "bank", "cheque", "other"]);

/** SQL for the commission of one payment. r = rule jsonb, base = this payment, full = whole amount */
const amountSql = (r, base, full, defPct) => sql`
  LEAST(${base}, round(
    CASE WHEN ${r}->>'type' = 'fixed'
      THEN CASE WHEN COALESCE(${full}, 0) > 0
             THEN COALESCE((${r}->>'value')::numeric, 0) * ${base} / ${full}
             ELSE COALESCE((${r}->>'value')::numeric, 0) END
      ELSE ${base} * LEAST(COALESCE((${r}->>'value')::numeric, ${defPct}), 100) / 100
    END, 2))`;

const ruleOn = (r) => sql`(a.commission->>'enabled') = 'true' AND COALESCE(${r}->>'enabled', 'true') <> 'false'`;

/** Commission for closing transactions matching `where` (alias t). Returns rows created. */
export async function accrueClosing(tx, where) {
  const r = sql`a.commission->'closing'`;
  const res = await tx.execute(sql`
    INSERT INTO agent_commissions (id, admin_id, agent_id, program_id, member_id, closing_member_id, source, source_id,
      base_amount, rate_type, rate_value, amount, payment_date)
    SELECT gen_random_uuid()::text, a.admin_id, a.id, t.program_id, t.payer_member_id, t.closing_member_id,
      ${COMMISSION_SOURCE.CLOSING}, t.id, t.amount,
      CASE WHEN ${r}->>'type' = 'fixed' THEN 'fixed' ELSE 'percentage' END,
      COALESCE((${r}->>'value')::numeric, ${DEFAULT_CLOSING_PERCENT}),
      ${amountSql(r, sql`t.amount`, sql`d.amount`, DEFAULT_CLOSING_PERCENT)}, t.payment_date
    FROM transactions t
    JOIN members p ON p.id = t.payer_member_id
    JOIN agents a ON a.id = p.agent_id
    LEFT JOIN dues d ON d.id = t.due_id
    WHERE t.status = 'completed' AND t.amount > 0 AND ${ruleOn(r)} AND (${where})
      AND ${amountSql(r, sql`t.amount`, sql`d.amount`, DEFAULT_CLOSING_PERCENT)} > 0
    ON CONFLICT (source, source_id, kind) DO NOTHING`);
  return res.rowCount ?? 0;
}

/** Commission for join fee instalments matching `where` (alias jp). */
export async function accrueJoinFees(tx, where) {
  const r = sql`a.commission->'joinFees'`;
  const res = await tx.execute(sql`
    INSERT INTO agent_commissions (id, admin_id, agent_id, program_id, member_id, source, source_id,
      base_amount, rate_type, rate_value, amount, payment_date)
    SELECT gen_random_uuid()::text, a.admin_id, a.id, jp.program_id, jp.member_id,
      ${COMMISSION_SOURCE.JOIN_FEES}, jp.id, jp.amount,
      CASE WHEN ${r}->>'type' = 'fixed' THEN 'fixed' ELSE 'percentage' END,
      COALESCE((${r}->>'value')::numeric, ${DEFAULT_JOIN_FEES_PERCENT}),
      ${amountSql(r, sql`jp.amount`, sql`m.join_fees`, DEFAULT_JOIN_FEES_PERCENT)}, jp.payment_date
    FROM join_fee_payments jp
    JOIN members m ON m.id = jp.member_id
    JOIN agents a ON a.id = m.agent_id
    WHERE jp.amount > 0 AND ${ruleOn(r)} AND (${where})
      AND ${amountSql(r, sql`jp.amount`, sql`m.join_fees`, DEFAULT_JOIN_FEES_PERCENT)} > 0
    ON CONFLICT (source, source_id, kind) DO NOTHING`);
  return res.rowCount ?? 0;
}

/** A payment was undone. sourceWhere = condition on alias c (c.source_id …). */
export async function cancelCommissions(tx, source, sourceWhere, note = "Payment reversed") {
  const cancelled = await tx.execute(sql`
    UPDATE agent_commissions c SET status = 'cancelled', cancelled_at = now(), note = ${note}
    WHERE c.source = ${source} AND c.kind = 'earned' AND c.status = 'pending' AND (${sourceWhere})`);
  const reversed = await tx.execute(sql`
    INSERT INTO agent_commissions (id, admin_id, agent_id, program_id, member_id, closing_member_id, source, source_id, kind,
      base_amount, rate_type, rate_value, amount, payment_date, note)
    SELECT gen_random_uuid()::text, c.admin_id, c.agent_id, c.program_id, c.member_id, c.closing_member_id, c.source, c.source_id,
      'reversal', -c.base_amount, c.rate_type, c.rate_value, -c.amount, ${fmtISO(todayIST())}::date, ${note}
    FROM agent_commissions c
    WHERE c.source = ${source} AND c.kind = 'earned' AND c.status = 'paid' AND (${sourceWhere})
    ON CONFLICT (source, source_id, kind) DO NOTHING`);
  return { cancelled: cancelled.rowCount ?? 0, reversals: reversed.rowCount ?? 0 };
}

const inList = (ids) => sql.join(ids.map((x) => sql`${x}`), sql`, `);
export const accrueClosingFor = (tx, txIds) => (txIds.length ? accrueClosing(tx, sql`t.id IN (${inList(txIds)})`) : 0);
export const accrueJoinFeesFor = (tx, ids) => (ids.length ? accrueJoinFees(tx, sql`jp.id IN (${inList(ids)})`) : 0);

// ─── reading ───────────────────────────────────────────────────────────────

function filterSql(agentId, f = {}) {
  const q = f.q ? `%${String(f.q).trim()}%` : null;
  return sql`c.agent_id = ${agentId}
    ${f.programId ? sql`AND c.program_id = ${f.programId}` : sql``}
    ${f.source ? sql`AND c.source = ${f.source}` : sql``}
    ${f.status ? sql`AND c.status = ${f.status}` : sql``}
    ${f.payoutId ? sql`AND c.payout_id = ${f.payoutId}` : sql``}
    ${f.from ? sql`AND c.payment_date >= ${fmtISO(toDate(f.from))}::date` : sql``}
    ${f.to ? sql`AND c.payment_date <= ${fmtISO(toDate(f.to))}::date` : sql``}
    ${q ? sql`AND (m.display_name ILIKE ${q} OR m.registration_number ILIKE ${q} OR cm.display_name ILIKE ${q}
            OR cm.registration_number ILIKE ${q})` : sql``}`;
}

async function assertAgent(adminId, agentId) {
  const { rows: [a] } = await db.execute(sql`SELECT id, display_name, commission FROM agents WHERE id = ${agentId} AND admin_id = ${adminId}`);
  if (!a) throw notFound("Agent not found");
  return a;
}

/** Totals for one agent (optionally one program). */
export async function commissionSummary(adminId, agentId, { programId } = {}) {
  await assertAgent(adminId, agentId);
  const { rows: [s] } = await db.execute(sql`
    SELECT
      COALESCE(sum(amount) FILTER (WHERE kind = 'earned' AND status <> 'cancelled'), 0)::float8 AS earned,
      COALESCE(sum(amount) FILTER (WHERE kind = 'earned' AND status <> 'cancelled' AND source = 'join_fees'), 0)::float8 AS join_fees,
      COALESCE(sum(amount) FILTER (WHERE kind = 'earned' AND status <> 'cancelled' AND source = 'closing'), 0)::float8 AS closing,
      COALESCE(sum(amount) FILTER (WHERE kind = 'reversal'), 0)::float8 AS reversed,
      COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::float8 AS paid,
      COALESCE(sum(amount) FILTER (WHERE status = 'pending'), 0)::float8 AS pending,
      count(*) FILTER (WHERE status = 'pending')::int AS pending_count,
      count(*) FILTER (WHERE kind = 'earned' AND status <> 'cancelled')::int AS earned_count,
      count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
      min(payment_date) FILTER (WHERE status = 'pending') AS oldest_pending
    FROM agent_commissions
    WHERE agent_id = ${agentId} ${programId ? sql`AND program_id = ${programId}` : sql``}`);
  const { rows: [p] } = await db.execute(sql`
    SELECT count(*)::int AS payouts, max(payout_date) AS last_payout_date
    FROM agent_commission_payouts WHERE agent_id = ${agentId} AND status = 'paid'`);
  return camel({ ...s, ...p });
}

/** History list, newest first, paged. */
export async function listCommissions(adminId, agentId, f = {}) {
  await assertAgent(adminId, agentId);
  const size = Math.min(Math.max(Number(f.pageSize) || 50, 1), f.all ? 100000 : 500);
  const offset = f.all ? 0 : (Math.max(Number(f.page) || 1, 1) - 1) * size;
  const { rows } = await db.execute(sql`
    SELECT c.id, c.program_id, c.member_id, c.closing_member_id, c.source, c.source_id, c.kind, c.base_amount, c.rate_type,
      c.rate_value::float8 AS rate_value, c.amount::float8 AS amount, c.status, c.payout_id, c.payment_date, c.note,
      c.cancelled_at, c.created_at,
      m.display_name AS member_name, m.registration_number AS member_reg_no, m.village AS member_village,
      cm.display_name AS closing_member_name, cm.registration_number AS closing_reg_no, cm.closing_date,
      pr.name AS program_name, po.payout_number, po.payout_date,
      count(*) OVER()::int AS total_count, sum(c.amount) OVER()::float8 AS total_amount
    FROM agent_commissions c
    LEFT JOIN members m ON m.id = c.member_id
    LEFT JOIN members cm ON cm.id = c.closing_member_id
    LEFT JOIN programs pr ON pr.id = c.program_id
    LEFT JOIN agent_commission_payouts po ON po.id = c.payout_id
    WHERE ${filterSql(agentId, f)}
    ORDER BY c.payment_date DESC, c.created_at DESC
    LIMIT ${size} OFFSET ${offset}`);
  const total = rows[0]?.total_count || 0;
  const totalAmount = rows[0]?.total_amount || 0;
  rows.forEach((r) => { delete r.total_count; delete r.total_amount; });
  return { commissions: camel(rows), total, totalAmount: Math.round(totalAmount * 100) / 100, page: Number(f.page) || 1, pageSize: size };
}

export async function listPayouts(adminId, agentId) {
  await assertAgent(adminId, agentId);
  const { rows } = await db.execute(sql`
    SELECT id, payout_number, amount::float8 AS amount, payment_mode, reference, note, payout_date, commission_count,
      status, created_by_name, reverted_at, revert_reason, created_at
    FROM agent_commission_payouts WHERE agent_id = ${agentId}
    ORDER BY payout_date DESC, created_at DESC LIMIT 500`);
  return camel(rows);
}

/** Per-agent pending / paid totals (agents list). */
export async function agentsCommissionTotals(adminId, { programId } = {}) {
  const { rows } = await db.execute(sql`
    SELECT agent_id,
      COALESCE(sum(amount) FILTER (WHERE kind = 'earned' AND status <> 'cancelled'), 0)::float8 AS earned,
      COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::float8 AS paid,
      COALESCE(sum(amount) FILTER (WHERE status = 'pending'), 0)::float8 AS pending
    FROM agent_commissions WHERE admin_id = ${adminId} ${programId ? sql`AND program_id = ${programId}` : sql``}
    GROUP BY agent_id`);
  return camel(rows);
}

// ─── paying the agent ───────────────────────────────────────────────────────

/**
 * body: { mode: "selected" | "all" | "upto", commissionIds?, upto? (amount), filters? {programId, source, from, to},
 *         paymentMode, reference, note, payoutDate }
 *  - selected: exactly these pending rows
 *  - all     : every pending row matching filters (reversals included, so they are settled too)
 *  - upto    : oldest pending rows first while the running total stays ≤ upto
 */
export async function createPayout(adminId, agentId, body = {}, auth) {
  const agent = await assertAgent(adminId, agentId);
  const mode = body.mode || (Array.isArray(body.commissionIds) ? "selected" : "all");
  const paymentMode = String(body.paymentMode || "cash").toLowerCase();
  if (!MODES.has(paymentMode)) throw badRequest(`paymentMode must be one of ${[...MODES].join(", ")}`);
  const payoutDate = fmtISO(toDate(body.payoutDate) || todayIST());
  const f = body.filters || {};

  return db.transaction(async (tx) => {
    let where;
    if (mode === "selected") {
      const ids = (body.commissionIds || []).map(String);
      if (!ids.length) throw badRequest("Select at least one commission entry");
      where = sql`c.id IN (${inList(ids)})`;
    } else {
      where = sql`TRUE
        ${f.programId ? sql`AND c.program_id = ${f.programId}` : sql``}
        ${f.source ? sql`AND c.source = ${f.source}` : sql``}
        ${f.from ? sql`AND c.payment_date >= ${fmtISO(toDate(f.from))}::date` : sql``}
        ${f.to ? sql`AND c.payment_date <= ${fmtISO(toDate(f.to))}::date` : sql``}`;
    }
    const { rows: open } = await tx.execute(sql`
      SELECT c.id, c.amount::float8 AS amount FROM agent_commissions c
      WHERE c.agent_id = ${agentId} AND c.status = 'pending' AND ${where}
      ORDER BY c.payment_date, c.created_at
      FOR UPDATE`);
    let chosen = open;
    if (mode === "upto") {
      const cap = Number(body.upto);
      if (!(cap > 0)) throw badRequest("Enter the amount to pay");
      chosen = [];
      let run = 0;
      for (const r of open) {
        if (run + r.amount > cap + 1e-9) break;
        run += r.amount;
        chosen.push(r);
      }
    }
    if (!chosen.length) throw conflict("No pending commission to pay for this selection");
    const amount = Math.round(chosen.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    if (!(amount > 0)) throw badRequest(`Total of the chosen entries is ₹${amount} — nothing to pay`);

    const { rows: [n] } = await tx.execute(sql`SELECT count(*)::int + 1 AS n FROM agent_commission_payouts WHERE admin_id = ${adminId}`);
    const payoutNumber = `COM-${payoutDate.replace(/-/g, "")}-${String(n.n).padStart(4, "0")}`;
    const { rows: [p] } = await tx.execute(sql`
      INSERT INTO agent_commission_payouts (id, admin_id, agent_id, payout_number, amount, payment_mode, reference, note,
        payout_date, commission_count, created_by_id, created_by_name)
      VALUES (gen_random_uuid()::text, ${adminId}, ${agentId}, ${payoutNumber}, ${amount}, ${paymentMode},
        ${String(body.reference || "")}, ${String(body.note || "")}, ${payoutDate}::date, ${chosen.length},
        ${auth?.accountId || ""}, ${auth?.displayName || ""})
      RETURNING id, payout_number, amount::float8 AS amount, payout_date`);
    await tx.execute(sql`
      UPDATE agent_commissions SET status = 'paid', payout_id = ${p.id}
      WHERE id IN (${inList(chosen.map((r) => r.id))})`);
    return { success: true, payout: camel(p), entries: chosen.length, agentName: agent.display_name };
  });
}

export async function revertPayout(adminId, payoutId, { reason = "" } = {}) {
  return db.transaction(async (tx) => {
    const { rows: [p] } = await tx.execute(sql`
      SELECT * FROM agent_commission_payouts WHERE id = ${payoutId} AND admin_id = ${adminId} FOR UPDATE`);
    if (!p) throw notFound("Payout not found");
    if (p.status !== "paid") throw conflict("Payout is already reverted");
    await tx.execute(sql`
      UPDATE agent_commission_payouts SET status = 'reverted', reverted_at = now(), revert_reason = ${String(reason)}
      WHERE id = ${payoutId}`);
    const r = await tx.execute(sql`UPDATE agent_commissions SET status = 'pending', payout_id = NULL WHERE payout_id = ${payoutId}`);
    return { success: true, entries: r.rowCount ?? 0, agentId: p.agent_id };
  });
}

/**
 * Commission for payments made before commission was switched on (or before this feature).
 * Uses the agent's current rates; already-counted payments are skipped.
 */
export async function accruePast(adminId, agentId, { programId, from, to, sources = ["join_fees", "closing"] } = {}) {
  await assertAgent(adminId, agentId);
  const fromD = from ? fmtISO(toDate(from)) : null;
  const toD = to ? fmtISO(toDate(to)) : null;
  return db.transaction(async (tx) => {
    let closing = 0, joinFees = 0;
    if (sources.includes("closing")) {
      closing = await accrueClosing(tx, sql`a.id = ${agentId}
        ${programId ? sql`AND t.program_id = ${programId}` : sql``}
        ${fromD ? sql`AND t.payment_date >= ${fromD}::date` : sql``}
        ${toD ? sql`AND t.payment_date <= ${toD}::date` : sql``}`);
    }
    if (sources.includes("join_fees")) {
      joinFees = await accrueJoinFees(tx, sql`a.id = ${agentId}
        ${programId ? sql`AND jp.program_id = ${programId}` : sql``}
        ${fromD ? sql`AND jp.payment_date >= ${fromD}::date` : sql``}
        ${toD ? sql`AND jp.payment_date <= ${toD}::date` : sql``}`);
    }
    return { success: true, closing, joinFees, added: closing + joinFees };
  });
}
