// Advanced dashboard: every number the dashboard shows, in one call (a handful of SQL queries).
//
// Member buckets are exclusive, so they add up:
//   pending  = request not accepted yet
//   rejected = rejected / removed requests
//   closed   = closing (marriage) recorded
//   blocked  = accepted, not closed, blocked
//   inactive = accepted, not closed, not blocked, inactive
//   active   = accepted, not closed, active, not blocked
// "On books" = active + inactive + blocked + closed.  Soft-deleted members are counted separately.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

const BUCKET = sql`
  CASE
    WHEN m.status = 'pending' THEN 'pending'
    WHEN m.status IN ('rejected', 'removed') THEN 'rejected'
    WHEN m.closing_date IS NOT NULL OR m.status = 'closed' THEN 'closed'
    WHEN m.blocked THEN 'blocked'
    WHEN NOT m.active THEN 'inactive'
    ELSE 'active'
  END`;

const int = (v) => Number(v) || 0;

/** "2026-10" for each of the last n months, oldest first (IST calendar) */
function lastMonths(n, today = new Date()) {
  const ist = new Date(today.getTime() + 330 * 60000);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export async function programAnalytics(programId, { agentId, months = 12 } = {}) {
  const agentM = agentId ? sql`AND m.agent_id = ${agentId}` : sql``;
  const monthKeys = lastMonths(months);
  const fromMonth = `${monthKeys[0]}-01`;

  // ── 1. member buckets + gender + join fees ─────────────────────────────
  const { rows: [c] } = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} = 'active')::int   AS active,
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} = 'inactive')::int AS inactive,
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} = 'blocked')::int  AS blocked,
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} = 'closed')::int   AS closed,
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} = 'pending')::int  AS pending,
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} = 'rejected')::int AS rejected,
      count(*) FILTER (WHERE m.deleted)::int                                AS deleted,
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} = 'active' AND lower(m.gender) IN ('male', 'm', 'पुरुष'))::int   AS active_male,
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} = 'active' AND lower(m.gender) IN ('female', 'f', 'महिला'))::int AS active_female,
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} IN ('active','inactive','blocked','closed') AND m.join_fees > 0 AND m.join_fees_done)::int     AS join_fees_done,
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} IN ('active','inactive','blocked','closed') AND m.join_fees > 0 AND NOT m.join_fees_done)::int AS join_fees_pending,
      COALESCE(sum(m.join_fees_remaining_amount) FILTER (WHERE NOT m.deleted AND ${BUCKET} IN ('active','inactive','blocked','closed') AND m.join_fees > 0 AND NOT m.join_fees_done), 0)::int AS join_fees_due,
      count(*) FILTER (WHERE NOT m.deleted AND ${BUCKET} IN ('active','inactive','blocked','closed') AND m.date_join >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date)::int AS joined_this_month,
      count(*) FILTER (WHERE NOT m.deleted AND m.closing_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date)::int AS closed_this_month
    FROM members m
    WHERE m.program_id = ${programId} ${agentM}`);

  const members = {
    active: c.active, inactive: c.inactive, blocked: c.blocked, closed: c.closed,
    pending: c.pending, rejected: c.rejected, deleted: c.deleted,
    onBooks: c.active + c.inactive + c.blocked + c.closed,
    activeMale: c.active_male, activeFemale: c.active_female,
    activeOtherGender: Math.max(0, c.active - c.active_male - c.active_female),
    joinedThisMonth: c.joined_this_month, closedThisMonth: c.closed_this_month,
  };

  // ── 2. money: one pass over transactions and one over dues, totals per payer,
  //    then summed per agent (fast even with lakhs of rows; uses the covering indexes) ──
  const payerScope = agentId
    ? sql`AND payer_member_id IN (SELECT id FROM members WHERE program_id = ${programId} AND agent_id = ${agentId})`
    : sql``;
  const { rows: perAgentMoney } = await db.execute(sql`
    WITH tx AS (
      SELECT payer_member_id AS pid, sum(amount)::bigint AS collected, count(*)::int AS n,
             COALESCE(sum(amount) FILTER (WHERE payment_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date), 0)::bigint AS this_month,
             COALESCE(sum(amount) FILTER (WHERE payment_date = (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)::bigint AS today,
             COALESCE(sum(amount) FILTER (WHERE lower(payment_method) = 'cash'), 0)::bigint AS cash
      FROM transactions WHERE program_id = ${programId} AND status = 'completed' ${payerScope}
      GROUP BY payer_member_id
    ), du AS (
      SELECT payer_member_id AS pid, sum(amount)::bigint AS billed,
             COALESCE(sum(amount - paid_amount) FILTER (WHERE status <> 'paid'), 0)::bigint AS outstanding,
             count(*) FILTER (WHERE status <> 'paid')::int AS open_dues
      FROM dues WHERE program_id = ${programId} ${payerScope}
      GROUP BY payer_member_id
    )
    SELECT m.agent_id,
           COALESCE(sum(tx.collected), 0)::bigint AS collected, COALESCE(sum(tx.n), 0)::int AS txn_count,
           COALESCE(sum(tx.this_month), 0)::bigint AS this_month, COALESCE(sum(tx.today), 0)::bigint AS today,
           COALESCE(sum(tx.cash), 0)::bigint AS cash,
           COALESCE(sum(du.billed), 0)::bigint AS billed, COALESCE(sum(du.outstanding), 0)::bigint AS outstanding,
           COALESCE(sum(du.open_dues), 0)::int AS open_dues, count(*) FILTER (WHERE du.open_dues > 0)::int AS members_with_dues
    FROM members m
    LEFT JOIN tx ON tx.pid = m.id
    LEFT JOIN du ON du.pid = m.id
    WHERE m.program_id = ${programId} ${agentM}
    GROUP BY m.agent_id`);
  const sumOf = (k) => perAgentMoney.reduce((s, r) => s + int(r[k]), 0);
  const t = { collected: sumOf("collected"), txn_count: sumOf("txn_count"), this_month: sumOf("this_month"), today: sumOf("today"), cash: sumOf("cash") };
  t.online = t.collected - t.cash;
  const d = { outstanding: sumOf("outstanding"), open_dues: sumOf("open_dues"), members_with_dues: sumOf("members_with_dues"), billed: sumOf("billed") };

  const { rows: [j] } = await db.execute(sql`
    SELECT COALESCE(sum(j.amount), 0)::bigint AS join_fees
    FROM join_fee_payments j JOIN members m ON m.id = j.member_id
    WHERE j.program_id = ${programId} ${agentM}`);

  const money = {
    collected: int(t.collected), thisMonth: int(t.this_month), today: int(t.today),
    cash: int(t.cash), online: int(t.online), transactions: t.txn_count,
    outstanding: int(d.outstanding), openDues: d.open_dues, membersWithDues: d.members_with_dues,
    billed: int(d.billed),
    collectionRate: int(d.billed) ? Math.round((1000 * (int(d.billed) - int(d.outstanding))) / int(d.billed)) / 10 : null,
    joinFeesCollected: int(j.join_fees), joinFeesDue: c.join_fees_due,
    joinFeesDoneMembers: c.join_fees_done, joinFeesPendingMembers: c.join_fees_pending,
  };

  // ── 3. last 12 months trend ───────────────────────────────────────────
  const { rows: tm } = await db.execute(sql`
    SELECT to_char(t.payment_date, 'YYYY-MM') AS month, COALESCE(sum(t.amount), 0)::bigint AS amount
    FROM transactions t JOIN members m ON m.id = t.payer_member_id
    WHERE t.program_id = ${programId} AND t.status = 'completed' AND t.payment_date >= ${fromMonth} ${agentM}
    GROUP BY 1`);
  const { rows: jm } = await db.execute(sql`
    SELECT to_char(m.date_join, 'YYYY-MM') AS month, count(*)::int AS n
    FROM members m
    WHERE m.program_id = ${programId} AND NOT m.deleted AND m.status NOT IN ('pending','rejected','removed')
      AND m.date_join >= ${fromMonth} ${agentM}
    GROUP BY 1`);
  const { rows: cm } = await db.execute(sql`
    SELECT to_char(m.closing_date, 'YYYY-MM') AS month, count(*)::int AS n
    FROM members m
    WHERE m.program_id = ${programId} AND NOT m.deleted AND m.closing_date >= ${fromMonth} ${agentM}
    GROUP BY 1`);
  const by = (rows, k) => Object.fromEntries(rows.map((r) => [r.month, int(r[k])]));
  const col = by(tm, "amount"), joins = by(jm, "n"), closes = by(cm, "n");
  const trend = monthKeys.map((m) => ({ month: m, collected: col[m] || 0, joined: joins[m] || 0, closed: closes[m] || 0 }));

  // ── 4. agent-wise ──────────────────────────────────────────────────────
  const { rows: ag0 } = await db.execute(sql`
    SELECT m.agent_id, a.display_name, a.phone, a.city, a.active AS agent_active, a.deleted AS agent_deleted,
      count(*) FILTER (WHERE ${BUCKET} = 'active')::int   AS active,
      count(*) FILTER (WHERE ${BUCKET} = 'inactive')::int AS inactive,
      count(*) FILTER (WHERE ${BUCKET} = 'blocked')::int  AS blocked,
      count(*) FILTER (WHERE ${BUCKET} = 'closed')::int   AS closed,
      count(*) FILTER (WHERE ${BUCKET} = 'pending')::int  AS pending,
      count(*) FILTER (WHERE ${BUCKET} IN ('active','inactive','blocked','closed') AND m.date_join >= date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date)::int AS joined_this_month
    FROM members m LEFT JOIN agents a ON a.id = m.agent_id
    WHERE m.program_id = ${programId} AND NOT m.deleted ${agentM}
    GROUP BY m.agent_id, a.display_name, a.phone, a.city, a.active, a.deleted`);
  const moneyByAgent = new Map(perAgentMoney.map((r) => [r.agent_id ?? null, r]));
  const ag = ag0.map((r) => {
    const mm = moneyByAgent.get(r.agent_id ?? null) || {};
    return { ...r, collected: mm.collected || 0, this_month: mm.this_month || 0, outstanding: mm.outstanding || 0, billed: mm.billed || 0 };
  });

  const agents = ag.map((r) => {
    const onBooks = r.active + r.inactive + r.blocked + r.closed;
    const billed = int(r.billed), outstanding = int(r.outstanding);
    return {
      agentId: r.agent_id,
      name: r.agent_id ? (r.display_name || "(deleted agent)") : "No agent (admin)",
      phone: r.phone || "", city: r.city || "",
      agentActive: r.agent_id ? (r.agent_active && !r.agent_deleted) : null,
      total: onBooks, active: r.active, inactive: r.inactive, blocked: r.blocked, closed: r.closed, pending: r.pending,
      joinedThisMonth: r.joined_this_month,
      collected: int(r.collected), thisMonth: int(r.this_month), outstanding, billed,
      collectionRate: billed ? Math.round((1000 * (billed - outstanding)) / billed) / 10 : null,
    };
  });
  // agents with no members yet still get a row (whole-trust view only)
  if (!agentId) {
    const seen = new Set(agents.map((a) => a.agentId));
    const { rows: all } = await db.execute(sql`
      SELECT a.id, a.display_name, a.phone, a.city, a.active FROM agents a
      JOIN programs p ON p.admin_id = a.admin_id
      WHERE p.id = ${programId} AND NOT a.deleted`);
    for (const a of all) if (!seen.has(a.id)) agents.push({
      agentId: a.id, name: a.display_name, phone: a.phone || "", city: a.city || "", agentActive: a.active,
      total: 0, active: 0, inactive: 0, blocked: 0, closed: 0, pending: 0, joinedThisMonth: 0,
      collected: 0, thisMonth: 0, outstanding: 0, billed: 0, collectionRate: null,
    });
  }
  agents.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // ── 5. recent activity ────────────────────────────────────────────────
  const { rows: rc } = await db.execute(sql`
    SELECT c.id, c.display_name, c.registration_number, c.closing_date, a.display_name AS agent_name,
           COALESCE(x.collected, 0)::bigint AS collected, COALESCE(x.due, 0)::bigint AS due, COALESCE(x.payers, 0)::int AS payers
    FROM (
      SELECT m.id, m.display_name, m.registration_number, m.closing_date, m.agent_id
      FROM members m
      WHERE m.program_id = ${programId} AND NOT m.deleted AND m.closing_date IS NOT NULL ${agentM}
      ORDER BY m.closing_date DESC, m.display_name
      LIMIT 6
    ) c
    LEFT JOIN agents a ON a.id = c.agent_id
    LEFT JOIN LATERAL (
      SELECT sum(d.paid_amount) AS collected, sum(d.amount - d.paid_amount) FILTER (WHERE d.status <> 'paid') AS due, count(*) AS payers
      FROM dues d WHERE d.closing_member_id = c.id
    ) x ON true
    ORDER BY c.closing_date DESC, c.display_name`);
  const { rows: rt } = await db.execute(sql`
    SELECT t.id, t.transaction_number, t.amount, t.payment_method, t.payment_date, t.created_at,
           m.display_name AS payer, m.registration_number, c.display_name AS closing_name
    FROM transactions t
    JOIN members m ON m.id = t.payer_member_id
    LEFT JOIN members c ON c.id = t.closing_member_id
    WHERE t.program_id = ${programId} AND t.status = 'completed' ${agentM}
    ORDER BY t.created_at DESC
    LIMIT 8`);

  return {
    generatedAt: new Date().toISOString(),
    members,
    money,
    trend,
    agents,
    agentCount: {
      total: agents.filter((a) => a.agentId).length,
      withMembersThisMonth: agents.filter((a) => a.agentId && a.joinedThisMonth > 0).length,
    },
    recentClosings: rc.map((r) => ({
      id: r.id, name: r.display_name, registrationNumber: r.registration_number, closingDate: r.closing_date,
      agentName: r.agent_name || "", collected: int(r.collected), due: int(r.due), payers: r.payers,
    })),
    recentPayments: rt.map((r) => ({
      id: r.id, number: r.transaction_number, amount: r.amount, method: r.payment_method, date: r.payment_date,
      payer: r.payer, registrationNumber: r.registration_number, closingName: r.closing_name || "",
    })),
  };
}
