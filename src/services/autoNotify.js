// Automatic push notifications (Expo) — sent after the action, never slowing or failing it.
//   payment received  → the payer (and his same-mobile family)  "भुगतान जमा हुआ ✅"
//   new closing       → every member who owes for it, with his own amount and last date
//                     → each agent: how much his members owe for it
// Each kind can be switched off in Settings → Mobile App (admins.extra.app.notify).
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { normalizeAppSettings } from "../lib/appSettings.js";
import { deliver, notifyMembers } from "../lib/push.js";
import { fmtDMY } from "../lib/dates.js";

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

async function settingsFor(adminId) {
  const { rows: [r] } = await db.execute(sql`SELECT extra->'app' AS app FROM admins WHERE id = ${adminId}`);
  return normalizeAppSettings(r?.app).notify;
}

/** After POST /programs/:id/payments — one message per payer of that batch. */
export async function notifyPayment(adminId, batchId) {
  if (!batchId || !(await settingsFor(adminId)).payment) return null;
  const { rows } = await db.execute(sql`
    SELECT t.payer_member_id AS member_id, m.display_name, m.registration_number, p.name AS program,
           sum(t.amount)::int AS total, count(*)::int AS n
    FROM transactions t JOIN members m ON m.id = t.payer_member_id JOIN programs p ON p.id = t.program_id
    WHERE t.batch_id = ${batchId} AND t.status = 'completed'
    GROUP BY 1, 2, 3, 4`);
  if (!rows.length) return null;
  return notifyMembers(adminId, rows.map((r) => ({
    memberId: r.member_id,
    title: "भुगतान जमा हुआ ✅",
    body: `${r.display_name}${r.registration_number ? ` (रजि. ${r.registration_number})` : ""}: ${inr(r.total)} — ${r.n} क्लोजिंग · ${r.program}। रसीद ऐप में देखें।`,
    data: { type: "payment", batchId },
  })));
}

/** After a closing is recorded — every payer gets his amount; agents get their members' total. */
export async function notifyClosing(adminId, closingMemberId) {
  const opt = await settingsFor(adminId);
  if (!opt.closing && !opt.agentClosing) return null;
  const { rows: [c] } = await db.execute(sql`
    SELECT m.display_name, m.village, m.registration_number, p.name AS program
    FROM members m JOIN programs p ON p.id = m.program_id WHERE m.id = ${closingMemberId}`);
  if (!c) return null;
  const { rows } = await db.execute(sql`
    SELECT d.payer_member_id AS member_id, (d.amount - d.paid_amount)::int AS owed, d.due_date, pm.agent_id
    FROM dues d JOIN members pm ON pm.id = d.payer_member_id
    WHERE d.closing_member_id = ${closingMemberId} AND d.status <> 'paid' AND d.amount > d.paid_amount`);
  if (!rows.length) return null;
  const who = `${c.display_name}${c.village ? ` (${c.village})` : ""}`;
  const out = {};
  if (opt.closing) {
    out.members = await notifyMembers(adminId, rows.map((r) => ({
      memberId: r.member_id,
      title: `नई क्लोजिंग: ${who}`,
      body: `${c.program} — आपकी राशि ${inr(r.owed)}${r.due_date ? ` · अंतिम तिथि ${fmtDMY(r.due_date)}` : ""}। ऐप से भुगतान देखें।`,
      data: { type: "closing", closingId: closingMemberId },
    })));
  }
  if (opt.agentClosing) {
    const byAgent = new Map();
    for (const r of rows) {
      if (!r.agent_id) continue;
      const a = byAgent.get(r.agent_id) || { n: 0, total: 0 };
      a.n++; a.total += r.owed;
      byAgent.set(r.agent_id, a);
    }
    if (byAgent.size) {
      const { rows: accs } = await db.execute(sql`
        SELECT id, agent_id FROM accounts WHERE active AND role = 'agent'
          AND agent_id IN (${sql.join([...byAgent.keys()].map((x) => sql`${x}`), sql`, `)})`);
      out.agents = await deliver(adminId, accs.map((a) => {
        const s = byAgent.get(a.agent_id);
        return { accountId: a.id, title: `नई क्लोजिंग: ${who}`, body: `${c.program} — आपके ${s.n} सदस्यों से ${inr(s.total)} वसूली बाकी।`, data: { type: "closing", closingId: closingMemberId } };
      }));
    }
  }
  return out;
}
