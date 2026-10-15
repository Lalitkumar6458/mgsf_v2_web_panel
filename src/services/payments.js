// Payments (old /api/payments/process). One Postgres transaction per request:
// dues are locked (FOR UPDATE), so the same closing can never be paid twice
// (old "single" mode did not check this).
import { sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { toDate, todayIST, fmtISO } from "../lib/dates.js";
import { camel } from "../lib/case.js";
import { accrueClosingFor, cancelCommissions } from "./commissions.js";

const METHODS = new Set(["cash", "online", "upi", "cheque", "bank", "other"]);

function batchCode() {
  return randomBytes(4).toString("base64").replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase().padEnd(6, "X");
}

function commonMeta(body) {
  const paymentMethod = String(body.paymentMethod || "cash").toLowerCase();
  if (!METHODS.has(paymentMethod)) throw badRequest(`paymentMethod must be one of ${[...METHODS].join(", ")}`);
  const paymentDate = fmtISO(toDate(body.paymentDate) || todayIST());
  const onlineReference = String(body.onlineReference || "").trim();
  return { paymentMethod, paymentDate, note: String(body.note || ""), onlineReference };
}

async function assertNewReference(tx, programId, ref) {
  if (!ref) return;
  const { rows } = await tx.execute(sql`
    SELECT 1 FROM transactions WHERE program_id = ${programId} AND online_reference = ${ref} AND status = 'completed' LIMIT 1`);
  if (rows.length) throw conflict("Duplicate reference number");
}

/** Lock open dues. where = SQL condition on alias d. */
async function lockOpenDues(tx, programId, where) {
  const { rows } = await tx.execute(sql`
    SELECT d.*, c.closing_date
    FROM dues d JOIN members c ON c.id = d.closing_member_id
    WHERE d.program_id = ${programId} AND d.status IN ('pending', 'partial') AND ${where}
    ORDER BY c.closing_date ASC, d.created_at ASC
    FOR UPDATE OF d`);
  return rows;
}

/** Write transactions + update dues. items: [{ due, pay }] */
async function writePayments(tx, programId, items, meta, auth, mode = "") {
  const ts = Date.now();
  const code = batchCode();
  const batchId = `BATCH-${code}`;
  let seq = 0, total = 0, fully = 0;
  const txIds = [];

  for (const { due, pay } of items) {
    if (pay <= 0) continue;
    seq++;
    const newPaid = due.paid_amount + pay;
    const isFull = newPaid >= due.amount;
    const txNumber = `TRX-${ts}-${code}-${String(seq).padStart(3, "0")}`;
    const { rows: [t] } = await tx.execute(sql`
      INSERT INTO transactions (id, program_id, transaction_number, batch_id, sequence_number, payer_member_id,
        closing_member_id, due_id, amount, is_full_payment, payment_method, payment_date, note, online_reference,
        bulk_payment_mode, created_by_id)
      VALUES (gen_random_uuid()::text, ${programId}, ${txNumber}, ${batchId}, ${seq}, ${due.payer_member_id},
        ${due.closing_member_id}, ${due.id}, ${pay}, ${isFull}, ${meta.paymentMethod}, ${meta.paymentDate}::date,
        ${meta.note}, ${meta.onlineReference}, ${mode}, ${auth?.accountId || ""})
      RETURNING id`);
    await tx.execute(sql`
      UPDATE dues SET paid_amount = ${newPaid}, status = ${isFull ? "paid" : "partial"}, paid_at = now(),
        paid_date = ${isFull ? meta.paymentDate : null}::date,
        payment_method = ${meta.paymentMethod}, online_reference = ${meta.onlineReference}, updated_at = now()
      WHERE id = ${due.id}`);
    txIds.push(t.id);
    total += pay;
    if (isFull) fully++;
  }
  // agent commission on these payments (agent of the payer, if commission is on for him)
  await accrueClosingFor(tx, txIds);
  return { batchId, processed: txIds.length, totalPaid: total, fullyPaid: fully, transactionIds: txIds };
}

/**
 * Single member pays for selected closings.
 * body: { programId, payerId, closingIds?: [closingMemberId], dueIds?: [], customTotalAmount?, paymentMethod, paymentDate, note, onlineReference }
 * Without customTotalAmount every selected due is paid in full; with it the amount is spread oldest-closing-first.
 */
export async function paySingle(body, auth) {
  const { programId, payerId } = body;
  const closingIds = body.closingIds || body.selectedClosingIds || [];
  const dueIds = body.dueIds || [];
  if (!programId || !payerId || (!closingIds.length && !dueIds.length)) throw badRequest("programId, payerId and closingIds/dueIds required");
  const meta = commonMeta(body);

  return db.transaction(async (tx) => {
    await assertNewReference(tx, programId, meta.onlineReference);
    const where = dueIds.length
      ? sql`d.payer_member_id = ${payerId} AND d.id IN (${sql.join(dueIds.map((x) => sql`${x}`), sql`, `)})`
      : sql`d.payer_member_id = ${payerId} AND d.closing_member_id IN (${sql.join(closingIds.map((x) => sql`${x}`), sql`, `)})`;
    const open = await lockOpenDues(tx, programId, where);
    if (!open.length) throw conflict("Selected closings are already paid or not owed by this member");

    const outstanding = open.reduce((s, d) => s + (d.amount - d.paid_amount), 0);
    let remaining = body.customTotalAmount ? Number(body.customTotalAmount) : outstanding;
    if (!(remaining > 0)) throw badRequest("Amount must be greater than 0");
    if (remaining > outstanding) throw badRequest(`Amount ₹${remaining} is more than outstanding ₹${outstanding}`);

    const items = [];
    for (const due of open) {
      if (remaining <= 0) break;
      const pay = Math.min(remaining, due.amount - due.paid_amount);
      items.push({ due, pay });
      remaining -= pay;
    }
    const r = await writePayments(tx, programId, items, meta, auth, "");
    return { success: true, ...r, remaining: outstanding - r.totalPaid, skipped: closingIds.length + dueIds.length - open.length };
  });
}

/**
 * Bulk payment (agent collects for many members).
 * body: { programId, memberIds, memberClosingSelections?: {memberId: [dueId]}, globalAmount?, paymentMethod, … }
 *  - custom mode: memberClosingSelections given → exactly those dues are paid in full
 *  - waterfall mode: globalAmount spread over members (most dues first), whole closings only
 */
export async function payBulk(body, auth) {
  const { programId, memberIds = [], memberClosingSelections, globalAmount } = body;
  if (!programId || !memberIds.length) throw badRequest("programId and memberIds required");
  const isCustom = memberClosingSelections && Object.keys(memberClosingSelections).length > 0;
  if (!isCustom && !(Number(globalAmount) > 0)) throw badRequest("Either memberClosingSelections or globalAmount required");
  const meta = commonMeta(body);

  return db.transaction(async (tx) => {
    await assertNewReference(tx, programId, meta.onlineReference);
    const open = await lockOpenDues(tx, programId, sql`d.payer_member_id IN (${sql.join(memberIds.map((x) => sql`${x}`), sql`, `)})`);
    const byMember = new Map();
    for (const d of open) {
      if (!byMember.has(d.payer_member_id)) byMember.set(d.payer_member_id, []);
      byMember.get(d.payer_member_id).push(d);
    }

    const items = [];
    if (isCustom) {
      for (const memberId of memberIds) {
        const wanted = new Set(memberClosingSelections[memberId] || []);
        for (const d of byMember.get(memberId) || []) {
          if (wanted.has(d.id) || wanted.has(d.closing_member_id)) items.push({ due: d, pay: d.amount - d.paid_amount });
        }
      }
    } else {
      let remaining = Number(globalAmount);
      const order = [...byMember.keys()].sort((a, b) => byMember.get(b).length - byMember.get(a).length);
      for (const memberId of order) {
        for (const d of byMember.get(memberId)) {
          const need = d.amount - d.paid_amount;
          if (need > remaining) break; // whole closings only (old behaviour)
          items.push({ due: d, pay: need });
          remaining -= need;
        }
        if (remaining <= 0) break;
      }
    }
    if (!items.length) throw badRequest("No valid pending closings found to process");

    const r = await writePayments(tx, programId, items, meta, auth, isCustom ? "custom_selection" : "waterfall");
    return {
      success: true,
      mode: isCustom ? "custom_selection" : "waterfall",
      membersProcessed: new Set(items.map((i) => i.due.payer_member_id)).size,
      closingsProcessed: r.processed,
      totalPaid: r.totalPaid,
      remaining: isCustom ? 0 : Number(globalAmount) - r.totalPaid,
      batchId: r.batchId,
    };
  });
}

/** Undo one transaction (wrong entry): marks it reversed and gives the amount back to the due. */
export async function reverseTransaction(transactionId, { reason = "" } = {}, auth) {
  return db.transaction(async (tx) => {
    const { rows: [t] } = await tx.execute(sql`SELECT * FROM transactions WHERE id = ${transactionId} FOR UPDATE`);
    if (!t) throw notFound("Transaction not found");
    if (t.status !== "completed") throw conflict("Transaction is already reversed");
    await tx.execute(sql`
      UPDATE transactions SET status = 'reversed', updated_at = now(),
        extra = extra || jsonb_build_object('reversedReason', ${reason}::text, 'reversedBy', ${auth?.accountId || ""}::text, 'reversedAt', now())
      WHERE id = ${t.id}`);
    if (t.due_id) {
      await tx.execute(sql`
        UPDATE dues SET paid_amount = GREATEST(paid_amount - ${t.amount}, 0),
          status = (CASE WHEN paid_amount - ${t.amount} <= 0 THEN 'pending' ELSE 'partial' END)::due_status,
          paid_at = CASE WHEN paid_amount - ${t.amount} <= 0 THEN NULL ELSE paid_at END,
          paid_date = NULL,
          updated_at = now()
        WHERE id = ${t.due_id}`);
    }
    const commission = await cancelCommissions(tx, "closing", sql`c.source_id = ${t.id}`, reason ? `Payment reversed: ${reason}` : "Payment reversed");
    return { success: true, transactionId: t.id, amount: t.amount, commission };
  });
}

/** Transactions list with filters + paging (old /transactions page). */
export const ALL_TRANSACTIONS_CAP = 50000;

export async function listTransactions(programId, { agentId, payerId, closingId, from, to, q, status = "completed", page = 1, pageSize = 50, all = false } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 500);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const where = sql`t.program_id = ${programId}
    ${status ? sql`AND t.status = ${status}` : sql``}
    ${agentId ? sql`AND p.agent_id = ${agentId}` : sql``}
    ${payerId ? sql`AND t.payer_member_id = ${payerId}` : sql``}
    ${closingId ? sql`AND t.closing_member_id = ${closingId}` : sql``}
    ${from ? sql`AND t.payment_date >= ${fmtISO(toDate(from))}::date` : sql``}
    ${to ? sql`AND t.payment_date <= ${fmtISO(toDate(to))}::date` : sql``}
    ${q ? sql`AND (p.display_name ILIKE ${"%" + q + "%"} OR p.registration_number ILIKE ${"%" + q + "%"}
              OR c.display_name ILIKE ${"%" + q + "%"} OR c.registration_number ILIKE ${"%" + q + "%"}
              OR t.transaction_number ILIKE ${"%" + q + "%"} OR t.online_reference ILIKE ${"%" + q + "%"})` : sql``}`;

  if (all) {
    // whole list in one query (Payments page / reports): no OFFSET paging, no window counts
    const { rows } = await db.execute(sql`
      SELECT t.id, t.program_id, t.transaction_number, t.batch_id, t.sequence_number, t.payer_member_id, t.closing_member_id,
             t.due_id, t.amount, t.is_full_payment, t.payment_method, t.payment_date, t.note, t.online_reference,
             t.online_verified, t.transaction_type, t.bulk_payment_mode, t.status, t.created_by_id, t.created_at, t.updated_at,
             p.display_name AS payer_name, p.father_name AS payer_father_name, p.registration_number AS payer_registration_number,
             p.phone AS payer_phone, p.photo_url AS payer_photo, p.agent_id,
             c.display_name AS closing_member_name, c.father_name AS closing_member_father_name,
             c.registration_number AS closing_member_registration_number, c.closing_date AS marriage_date
      FROM transactions t
      JOIN members p ON p.id = t.payer_member_id
      LEFT JOIN members c ON c.id = t.closing_member_id
      WHERE ${where}
      ORDER BY t.payment_date DESC, t.created_at DESC, t.sequence_number
      LIMIT ${ALL_TRANSACTIONS_CAP + 1}`);
    const capped = rows.length > ALL_TRANSACTIONS_CAP;
    if (capped) rows.length = ALL_TRANSACTIONS_CAP;
    const totalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);
    return { transactions: camel(rows), total: rows.length, totalAmount, capped, cap: ALL_TRANSACTIONS_CAP, page: 1, pageSize: rows.length };
  }

  const { rows } = await db.execute(sql`
    SELECT t.*, p.display_name AS payer_name, p.father_name AS payer_father_name, p.registration_number AS payer_registration_number,
           p.phone AS payer_phone, p.photo_url AS payer_photo, p.agent_id,
           c.display_name AS closing_member_name, c.father_name AS closing_member_father_name,
           c.registration_number AS closing_member_registration_number, c.closing_date AS marriage_date,
           count(*) OVER()::int AS total_count, sum(t.amount) OVER()::int AS total_amount
    FROM transactions t
    JOIN members p ON p.id = t.payer_member_id
    LEFT JOIN members c ON c.id = t.closing_member_id
    WHERE ${where}
    ORDER BY t.created_at DESC, t.sequence_number
    LIMIT ${size} OFFSET ${offset}`);
  const total = rows[0]?.total_count || 0;
  const totalAmount = rows[0]?.total_amount || 0;
  rows.forEach((r) => { delete r.total_count; delete r.total_amount; });
  return { transactions: camel(rows), total, totalAmount, page: Number(page) || 1, pageSize: size };
}
