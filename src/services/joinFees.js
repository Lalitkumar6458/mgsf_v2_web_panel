// Join fee instalments (old joinFeesTransactions). Member totals are recalculated
// from the instalments in the same transaction, so they can never drift.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest, notFound } from "../lib/errors.js";
import { toDate, todayIST, fmtISO } from "../lib/dates.js";
import { camel } from "../lib/case.js";
import { accrueJoinFeesFor, cancelCommissions } from "./commissions.js";

async function recalc(tx, memberId, { lastRef, lastMode } = {}) {
  await tx.execute(sql`
    UPDATE members m SET
      join_fees_paid_amount = s.paid,
      join_fees_remaining_amount = GREATEST(m.join_fees - s.paid, 0),
      join_fees_done = (m.join_fees > 0 AND s.paid >= m.join_fees),
      join_fees_txn_id = COALESCE(${lastRef ?? null}, m.join_fees_txn_id),
      join_fees_payment_type = COALESCE(${lastMode ?? null}, m.join_fees_payment_type),
      updated_at = now()
    FROM (SELECT COALESCE(sum(amount), 0)::int AS paid FROM join_fee_payments WHERE member_id = ${memberId}) s
    WHERE m.id = ${memberId}`);
}

export async function listJoinFeePayments(memberId) {
  const { rows } = await db.execute(sql`
    SELECT * FROM join_fee_payments WHERE member_id = ${memberId} ORDER BY payment_date DESC, created_at DESC`);
  return camel(rows);
}

/** One instalment inside the caller's transaction (no commission — call accrueJoinFeesFor with the ids). → id */
export async function joinFeeTx(tx, programId, memberId, amount, meta = {}, auth) {
  const mode = String(meta.paymentMode || "cash");
  const day = fmtISO(toDate(meta.paymentDate) || todayIST());
  const { rows: [m] } = await tx.execute(sql`SELECT id, program_id FROM members WHERE id = ${memberId} FOR UPDATE`);
  if (!m || m.program_id !== programId) throw notFound(`Member ${memberId} not found in this program`);
  const { rows: [jp] } = await tx.execute(sql`
    INSERT INTO join_fee_payments (id, program_id, member_id, amount, payment_mode, transaction_ref, payment_date, note,
      agent_id, created_by_id, created_by_name)
    VALUES (gen_random_uuid()::text, ${programId}, ${memberId}, ${amount}, ${mode}, ${meta.transactionId || ""},
      ${day}::date, ${meta.note || ""}, ${meta.agentId || null}, ${auth?.accountId || ""}, ${meta.createdByName || auth?.displayName || ""})
    RETURNING id`);
  await recalc(tx, memberId, { lastRef: meta.transactionId || null, lastMode: mode === "cash" ? "cash" : "online" });
  return jp.id;
}

/**
 * Record instalments for one or more members.
 * items: [{ memberId, amount }], meta: { paymentMode, transactionId, note, paymentDate, agentId, createdByName }
 */
export async function addJoinFeePayments(programId, items, meta = {}, auth) {
  const list = items.filter((i) => Number(i.amount) > 0);
  if (!list.length) throw badRequest("No amount to record");
  const mode = String(meta.paymentMode || "cash");
  const day = fmtISO(toDate(meta.paymentDate) || todayIST());
  return db.transaction(async (tx) => {
    let total = 0;
    const ids = [];
    for (const it of list) {
      const amount = Math.round(Number(it.amount));
      ids.push(await joinFeeTx(tx, programId, it.memberId, amount, { ...meta, paymentMode: mode, paymentDate: day }, auth));
      total += amount;
    }
    // agent commission (member's agent, if join-fees commission is on for him)
    const commissions = await accrueJoinFeesFor(tx, ids);
    return { success: true, recorded: list.length, totalAmount: total, commissions };
  });
}

export async function deleteJoinFeePayment(paymentId) {
  return db.transaction(async (tx) => {
    const { rows: [p] } = await tx.execute(sql`DELETE FROM join_fee_payments WHERE id = ${paymentId} RETURNING member_id, program_id, amount`);
    if (!p) throw notFound("Payment not found");
    await recalc(tx, p.member_id);
    await cancelCommissions(tx, "join_fees", sql`c.source_id = ${paymentId}`, "Join fee entry deleted");
    return { success: true, memberId: p.member_id, programId: p.program_id, amount: p.amount };
  });
}

/**
 * Join fee typed on the member form (Add / Accept / Edit member) instead of through the instalment drawer:
 * record the part that has no instalment yet as one instalment, so it shows in history and earns commission.
 * Only the difference is recorded, so members whose old payments were never itemised are not touched
 * unless their paid amount goes up.
 */
export async function recordFormJoinFee(tx, memberId, { previousPaid = null, note = "सदस्य फ़ॉर्म से" } = {}) {
  const { rows: [m] } = await tx.execute(sql`
    SELECT m.id, m.program_id, m.status, m.agent_id, m.join_fees_paid_amount, m.join_fees_txn_id,
      (SELECT COALESCE(sum(amount), 0)::int FROM join_fee_payments WHERE member_id = m.id) AS itemised
    FROM members m WHERE m.id = ${memberId}`);
  if (!m || m.status !== "accepted") return null;
  const paid = m.join_fees_paid_amount || 0;
  const gap = previousPaid === null ? paid - m.itemised : paid - Math.max(previousPaid, m.itemised);
  if (gap <= 0) return null;
  const { rows: [jp] } = await tx.execute(sql`
    INSERT INTO join_fee_payments (id, program_id, member_id, amount, payment_mode, transaction_ref, payment_date, note, agent_id)
    VALUES (gen_random_uuid()::text, ${m.program_id}, ${m.id}, ${gap}, ${m.join_fees_txn_id ? "online" : "cash"},
      ${m.join_fees_txn_id || ""}, ${fmtISO(todayIST())}::date, ${note}, ${m.agent_id})
    RETURNING id`);
  await accrueJoinFeesFor(tx, [jp.id]);
  return { amount: gap, paymentId: jp.id };
}
