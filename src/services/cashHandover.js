// Agent cash hisaab — how much cash each agent has collected (from his own login) and how much
// he has handed over to the trust; the difference is what he still holds.
//
//   collected = closing payments (transactions, cash, not reversed) + join-fee instalments (cash)
//               + advance (अग्रिम) deposits in cash (paying closings FROM advance is not new cash)
//               entered from the agent's own login
//   handed    = rows of cash_handovers (entered by the office when the agent deposits)
//   balance   = collected − handed   (all time — the balance carries over day to day)
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest, notFound } from "../lib/errors.js";

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
export const HANDOVER_MODES = ["cash", "bank", "upi"];

/** account ids of each agent's login(s) */
const agentAccounts = sql`SELECT acc.agent_id, acc.id AS account_id FROM accounts acc WHERE acc.role = 'agent' AND acc.agent_id IS NOT NULL`;

/** Collected per agent and day (cash only). */
function collectedRows(programId, { agentId, from, to } = {}) {
  return sql`
    WITH aa AS (${agentAccounts})
    SELECT aa.agent_id, x.day, sum(x.amount)::int AS amount, sum(x.n)::int AS entries, sum(x.jf)::int AS join_fees
    FROM (
      SELECT t.created_by_id AS account_id, t.payment_date AS day, t.amount, 1 AS n, 0 AS jf
      FROM transactions t
      WHERE t.program_id = ${programId} AND t.status = 'completed' AND t.payment_method = 'cash'
        ${from ? sql`AND t.payment_date >= ${from}::date` : sql``} ${to ? sql`AND t.payment_date <= ${to}::date` : sql``}
      UNION ALL
      SELECT j.created_by_id, j.payment_date, j.amount, 1, j.amount
      FROM join_fee_payments j
      WHERE j.program_id = ${programId} AND j.payment_mode = 'cash'
        ${from ? sql`AND j.payment_date >= ${from}::date` : sql``} ${to ? sql`AND j.payment_date <= ${to}::date` : sql``}
      UNION ALL
      -- advance (अग्रिम) taken in cash by the agent
      SELECT v.created_by_id, v.payment_date, v.amount, 1, 0
      FROM member_advances v
      WHERE v.program_id = ${programId} AND v.kind = 'deposit' AND v.method = 'cash' AND v.status = 'completed'
        ${from ? sql`AND v.payment_date >= ${from}::date` : sql``} ${to ? sql`AND v.payment_date <= ${to}::date` : sql``}
    ) x JOIN aa ON aa.account_id = x.account_id
    ${agentId ? sql`WHERE aa.agent_id = ${agentId}` : sql``}
    GROUP BY aa.agent_id, x.day`;
}

/** One line per agent of the trust: collected, handed, balance (all time) + today's figures. */
export async function cashSummary(adminId, programId, { today } = {}) {
  const day = isDay(today) ? today : new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const { rows } = await db.execute(sql`
    WITH c AS (${collectedRows(programId)}),
    cs AS (SELECT agent_id, sum(amount)::int AS collected, sum(join_fees)::int AS join_fees, sum(entries)::int AS entries,
                  COALESCE(sum(amount) FILTER (WHERE day = ${day}::date), 0)::int AS today_collected, max(day) AS last_collected
           FROM c GROUP BY agent_id),
    hs AS (SELECT agent_id, sum(amount)::int AS handed, max(handed_on) AS last_handed,
                  COALESCE(sum(amount) FILTER (WHERE handed_on = ${day}::date), 0)::int AS today_handed
           FROM cash_handovers WHERE program_id = ${programId} AND NOT deleted GROUP BY agent_id)
    SELECT a.id AS agent_id, a.display_name, a.phone,
           COALESCE(cs.collected, 0) AS collected, COALESCE(cs.join_fees, 0) AS join_fees, COALESCE(cs.entries, 0) AS entries,
           COALESCE(hs.handed, 0) AS handed, COALESCE(cs.today_collected, 0) AS today_collected, COALESCE(hs.today_handed, 0) AS today_handed,
           cs.last_collected, hs.last_handed
    FROM agents a LEFT JOIN cs ON cs.agent_id = a.id LEFT JOIN hs ON hs.agent_id = a.id
    WHERE a.admin_id = ${adminId}
    ORDER BY (COALESCE(cs.collected, 0) - COALESCE(hs.handed, 0)) DESC, a.display_name`);
  const agents = rows.map((r) => ({
    agentId: r.agent_id, name: r.display_name, phone: r.phone,
    collected: r.collected, joinFees: r.join_fees, entries: r.entries, handed: r.handed,
    balance: r.collected - r.handed, todayCollected: r.today_collected, todayHanded: r.today_handed,
    lastCollected: r.last_collected, lastHanded: r.last_handed,
  }));
  const sum = (k) => agents.reduce((s, a) => s + a[k], 0);
  return {
    today: day,
    agents,
    totals: { collected: sum("collected"), handed: sum("handed"), balance: sum("balance"), todayCollected: sum("todayCollected"), todayHanded: sum("todayHanded"),
      agentsHolding: agents.filter((a) => a.balance > 0).length },
  };
}

/** Day-wise ledger of one agent with a running balance (oldest → newest) + his handovers. */
export async function agentLedger(adminId, programId, agentId) {
  const { rows: [ag] } = await db.execute(sql`SELECT id, display_name, phone FROM agents WHERE id = ${agentId} AND admin_id = ${adminId}`);
  if (!ag) throw notFound("Agent nahi mila");
  const { rows: col } = await db.execute(collectedRows(programId, { agentId }));
  const { rows: hand } = await db.execute(sql`
    SELECT id, amount, handed_on, mode, note, received_by_name, created_at FROM cash_handovers
    WHERE program_id = ${programId} AND agent_id = ${agentId} AND NOT deleted ORDER BY handed_on, created_at`);
  const byDay = new Map();
  const d = (v) => (v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(v).slice(0, 10));
  for (const r of col) byDay.set(d(r.day), { day: d(r.day), collected: r.amount, entries: r.entries, handed: 0 });
  for (const h of hand) {
    const k = d(h.handed_on);
    const row = byDay.get(k) || { day: k, collected: 0, entries: 0, handed: 0 };
    row.handed += h.amount;
    byDay.set(k, row);
  }
  let bal = 0;
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((r) => ({ ...r, balance: (bal += r.collected - r.handed) }));
  return {
    agent: { id: ag.id, name: ag.display_name, phone: ag.phone },
    days: days.reverse(), // newest first for the screen
    handovers: hand.map((h) => ({ id: h.id, amount: h.amount, handedOn: d(h.handed_on), mode: h.mode, note: h.note, receivedBy: h.received_by_name, createdAt: h.created_at })).reverse(),
    balance: bal,
  };
}

export async function addHandover(adminId, programId, input, auth) {
  const amount = Math.round(Number(input?.amount));
  if (!(amount > 0) || amount > 10000000) throw badRequest("Rakam sahi daalein");
  const day = isDay(input?.handedOn) ? input.handedOn : new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const mode = HANDOVER_MODES.includes(input?.mode) ? input.mode : "cash";
  const { rows: [ag] } = await db.execute(sql`SELECT id FROM agents WHERE id = ${input?.agentId || ""} AND admin_id = ${adminId}`);
  if (!ag) throw notFound("Agent nahi mila");
  const { rows: [r] } = await db.execute(sql`
    INSERT INTO cash_handovers (id, admin_id, program_id, agent_id, amount, handed_on, mode, note, received_by, received_by_name)
    VALUES (gen_random_uuid()::text, ${adminId}, ${programId}, ${ag.id}, ${amount}, ${day}::date, ${mode},
      ${String(input?.note || "").slice(0, 300)}, ${auth?.accountId || ""}, ${auth?.displayName || ""})
    RETURNING id`);
  return { id: r.id, amount, handedOn: day, mode };
}

export async function deleteHandover(adminId, programId, id) {
  const { rowCount } = await db.execute(sql`
    UPDATE cash_handovers SET deleted = true WHERE id = ${id} AND admin_id = ${adminId} AND program_id = ${programId} AND NOT deleted`);
  if (!rowCount) throw notFound("Entry nahi mili");
  return { id };
}
