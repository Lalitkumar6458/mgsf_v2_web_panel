// Advance (अग्रिम) payments: a member (or his agent) gives money before closings are due; later,
// while paying closings, the office / agent chooses "advance se kaatein" and that much is taken from it.
//
//   addAdvance       deposit (cash / upi / …) → + balance; agent's cash counts in his cash hisaab
//   refundAdvance    money given back → − balance (not more than the balance)
//   reverseAdvance   a wrong deposit entry → reversed (only if that much is still unused)
//   useAdvanceTx     inside a payment: − balance, one "use" row per payment batch (payments.js)
//   returnAdvanceTx  a payment paid from advance is reversed → the amount comes back (payments.js)
//
// Balance changes always lock the member row first, so two payments can never spend the same rupee.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { toDate, todayIST, fmtISO } from "../lib/dates.js";
import { camel } from "../lib/case.js";
import { limitStatus } from "./fixedLimit.js";

export const ADVANCE_METHODS = ["cash", "upi", "online", "bank", "cheque"];
const inList = (ids) => sql.join(ids.map((x) => sql`${x}`), sql`, `);
const SIGNED = sql`CASE WHEN kind IN ('deposit', 'return') THEN amount ELSE -amount END`;

function whole(v, what = "Rakam") {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) throw badRequest(`${what} poore rupaye mein ho (jaise 500)`);
  if (n > 10000000) throw badRequest(`${what} bahut zyada hai`);
  return n;
}

/** memberId → balance (₹). Works inside a transaction too (pass tx). */
export async function advanceBalances(memberIds, tx = db) {
  const ids = [...new Set((memberIds || []).filter(Boolean))];
  const out = new Map(ids.map((id) => [id, 0]));
  if (!ids.length) return out;
  const { rows } = await tx.execute(sql`
    SELECT member_id, COALESCE(sum(${SIGNED}), 0)::int AS bal
    FROM member_advances WHERE member_id IN (${inList(ids)}) AND status = 'completed' GROUP BY member_id`);
  for (const r of rows) out.set(r.member_id, r.bal);
  return out;
}
export const advanceBalance = async (memberId, tx = db) => (await advanceBalances([memberId], tx)).get(memberId) || 0;

async function lockMember(tx, memberId) {
  const { rows: [m] } = await tx.execute(sql`SELECT id, program_id, agent_id, deleted, display_name FROM members WHERE id = ${memberId} FOR UPDATE`);
  if (!m) throw notFound("Sadasya nahi mila");
  return m;
}

const who = (auth) => ({ id: auth?.accountId || "", name: auth?.displayName || (auth?.role === "agent" ? "Agent" : "Admin"), agentId: auth?.role === "agent" ? auth.agentId : null });

/** Deposit. input: { amount, method, paymentDate, reference, note } */
export async function addAdvance(memberId, input = {}, auth) {
  const amount = whole(input.amount);
  const method = String(input.method || "cash").toLowerCase();
  if (!ADVANCE_METHODS.includes(method)) throw badRequest(`method: ${ADVANCE_METHODS.join(", ")}`);
  const reference = String(input.reference || input.onlineReference || "").trim().slice(0, 80);
  if (method !== "cash" && !reference) throw badRequest("UPI / online / cheque ka reference number daalein");
  const day = fmtISO(toDate(input.paymentDate) || todayIST());
  const by = who(auth);
  return db.transaction(async (tx) => {
    const m = await lockMember(tx, memberId);
    if (m.deleted) throw badRequest("Sadasya delete ho chuka hai");
    // fixed rakam: advance only up to what is left of it (paid + advance never more than the limit)
    const lim = await limitStatus(memberId, tx);
    if (lim.limit != null && amount > lim.advanceRoom) {
      throw badRequest(lim.advanceRoom > 0
        ? `Is sadasya ki fixed rakam ₹${lim.limit} hai — ab sirf ₹${lim.advanceRoom} advance le sakte hain`
        : `Is sadasya ki fixed rakam ₹${lim.limit} poori ho chuki hai — advance nahi le sakte`);
    }
    if (reference) {
      const { rows } = await tx.execute(sql`
        SELECT 1 FROM member_advances WHERE program_id = ${m.program_id} AND reference = ${reference} AND kind = 'deposit' AND status = 'completed' LIMIT 1`);
      if (rows.length) throw conflict("Ye reference number pehle se advance mein darj hai");
    }
    const { rows: [r] } = await tx.execute(sql`
      INSERT INTO member_advances (id, program_id, member_id, kind, amount, method, payment_date, reference, note, agent_id, created_by_id, created_by_name)
      VALUES (gen_random_uuid()::text, ${m.program_id}, ${memberId}, 'deposit', ${amount}, ${method}, ${day}::date, ${reference},
              ${String(input.note || "").slice(0, 300)}, ${by.agentId || m.agent_id || null}, ${by.id}, ${by.name})
      RETURNING *`);
    return { success: true, entry: camel(r), balance: await advanceBalance(memberId, tx) };
  });
}

/** Give advance money back to the member (office). */
export async function refundAdvance(memberId, input = {}, auth) {
  const amount = whole(input.amount);
  const method = String(input.method || "cash").toLowerCase();
  if (!ADVANCE_METHODS.includes(method)) throw badRequest(`method: ${ADVANCE_METHODS.join(", ")}`);
  const by = who(auth);
  return db.transaction(async (tx) => {
    const m = await lockMember(tx, memberId);
    const bal = await advanceBalance(memberId, tx);
    if (amount > bal) throw badRequest(`Advance mein sirf ₹${bal} hai`);
    const { rows: [r] } = await tx.execute(sql`
      INSERT INTO member_advances (id, program_id, member_id, kind, amount, method, payment_date, reference, note, created_by_id, created_by_name)
      VALUES (gen_random_uuid()::text, ${m.program_id}, ${memberId}, 'refund', ${amount}, ${method},
              ${fmtISO(toDate(input.paymentDate) || todayIST())}::date, ${String(input.reference || "").slice(0, 80)},
              ${String(input.note || "").slice(0, 300)}, ${by.id}, ${by.name})
      RETURNING *`);
    return { success: true, entry: camel(r), balance: bal - amount };
  });
}

/** Undo a wrong deposit / refund entry. A deposit can only go if that money is still unused. */
export async function reverseAdvance(entryId, { reason = "" } = {}, auth) {
  return db.transaction(async (tx) => {
    const { rows: [e0] } = await tx.execute(sql`SELECT member_id FROM member_advances WHERE id = ${entryId}`);
    if (!e0) throw notFound("Entry nahi mili");
    await lockMember(tx, e0.member_id);
    const { rows: [e] } = await tx.execute(sql`SELECT * FROM member_advances WHERE id = ${entryId} FOR UPDATE`);
    if (e.status !== "completed") throw conflict("Ye entry pehle se cancel hai");
    if (!["deposit", "refund"].includes(e.kind)) throw badRequest("Ye entry payment se bani hai — us payment ko reverse karein");
    const bal = await advanceBalance(e.member_id, tx);
    if (e.kind === "deposit" && e.amount > bal) throw conflict(`Is advance mein se ₹${e.amount - bal} closing payment mein lag chuka hai — pehle wo payment reverse karein`);
    await tx.execute(sql`
      UPDATE member_advances SET status = 'reversed',
        extra = extra || jsonb_build_object('reversedReason', ${String(reason)}::text, 'reversedBy', ${auth?.accountId || ""}::text, 'reversedAt', now())
      WHERE id = ${entryId}`);
    return { success: true, balance: await advanceBalance(e.member_id, tx) };
  });
}

/** Inside a payment transaction (member already locked): take `amount` from the advance. */
export async function useAdvanceTx(tx, { programId, memberId, amount, batchId, paymentDate, auth }) {
  if (!(amount > 0)) return;
  const bal = await advanceBalance(memberId, tx);
  if (amount > bal) throw conflict(`Advance mein sirf ₹${bal} hai`);
  const by = who(auth);
  await tx.execute(sql`
    INSERT INTO member_advances (id, program_id, member_id, kind, amount, method, payment_date, batch_id, note, created_by_id, created_by_name)
    VALUES (gen_random_uuid()::text, ${programId}, ${memberId}, 'use', ${amount}, 'advance', ${paymentDate}::date, ${batchId},
            'closing payment', ${by.id}, ${by.name})`);
}

/** A payment paid from advance was reversed → the money goes back to the advance. */
export async function returnAdvanceTx(tx, t, auth) {
  await tx.execute(sql`SELECT id FROM members WHERE id = ${t.payer_member_id} FOR UPDATE`);
  const by = who(auth);
  await tx.execute(sql`
    INSERT INTO member_advances (id, program_id, member_id, kind, amount, method, payment_date, batch_id, transaction_id, note, created_by_id, created_by_name)
    VALUES (gen_random_uuid()::text, ${t.program_id}, ${t.payer_member_id}, 'return', ${t.amount}, 'advance', ${fmtISO(todayIST())}::date,
            ${t.batch_id}, ${t.id}, 'payment reverse — advance wapas', ${by.id}, ${by.name})`);
}

/** One member's advance: balance + every entry (newest first). */
export async function memberAdvances(memberId) {
  const { rows } = await db.execute(sql`
    SELECT a.*, c.display_name AS closing_name FROM member_advances a
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT cm.display_name, ', ') AS display_name FROM transactions t JOIN members cm ON cm.id = t.closing_member_id
      WHERE a.kind = 'use' AND t.batch_id = a.batch_id AND t.payer_member_id = a.member_id AND t.payment_method = 'advance'
    ) c ON true
    WHERE a.member_id = ${memberId} ORDER BY a.created_at DESC LIMIT 300`);
  const t = rows.reduce((s, r) => {
    if (r.status !== "completed") return s;
    if (r.kind === "deposit") s.deposited += r.amount;
    else if (r.kind === "use") s.used += r.amount;
    else if (r.kind === "return") s.used -= r.amount;
    else if (r.kind === "refund") s.refunded += r.amount;
    return s;
  }, { deposited: 0, used: 0, refunded: 0 });
  return { memberId, balance: t.deposited - t.used - t.refunded, totals: t, entries: camel(rows) };
}

/** Program list: who has advance money (for the office). */
export async function programAdvances(programId, { agentId } = {}) {
  const { rows } = await db.execute(sql`
    SELECT m.id, m.display_name, m.registration_number, m.village, m.phone, m.agent_id, x.balance, x.last_at
    FROM (
      SELECT member_id, sum(${SIGNED})::int AS balance, max(created_at) AS last_at
      FROM member_advances WHERE program_id = ${programId} AND status = 'completed' GROUP BY member_id
    ) x JOIN members m ON m.id = x.member_id
    WHERE x.balance <> 0 ${agentId ? sql`AND m.agent_id = ${agentId}` : sql``}
    ORDER BY x.balance DESC`);
  return { members: camel(rows), total: rows.reduce((s, r) => s + r.balance, 0) };
}
