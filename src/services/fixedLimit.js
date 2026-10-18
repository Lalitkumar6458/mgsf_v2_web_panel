// Fixed rakam (seema) — a member pays at most `members.fixed_limit` in all for closings.
//
// Example: limit ₹15,200, kist ₹200. Closings come one by one; his dues are made as usual until their
// total reaches ₹15,200. The closing that crosses it gets only what is left (say ₹100), and closings after
// that give him no due at all. Advance can be taken only up to what is left of the limit.
//
// How it is kept right: after any change to a limited member's dues, `applyLimit` walks his dues in
// closing-date order. Money already paid is always kept; the rest of the limit is shared out oldest
// closing first. A due cut down keeps its full amount in `base_amount`, so it grows back when the limit
// is raised / removed or an earlier closing goes away. A due that gets nothing (and has nothing paid) is
// deleted; `resyncPayer` makes it again when the limit has room.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest, notFound } from "../lib/errors.js";
import { todayIST, fmtISO } from "../lib/dates.js";

/** Normalise a limit from a form: "", null, 0 → null (no limit); else whole rupees ≥ 1. */
export function normLimit(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "" || v === false) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw badRequest("Fixed rakam sahi number honi chahiye");
  if (!Number.isInteger(n)) throw badRequest("Fixed rakam poore rupaye mein daalein");
  return n === 0 ? null : n;
}

/**
 * Make each member's dues fit his fixed limit (or grow back to full when there is no limit).
 * Runs inside the caller's transaction, after the program lock. Returns { changed, removed }.
 */
export async function applyLimit(tx, memberIds) {
  const ids = [...new Set((memberIds || []).filter(Boolean))];
  let changed = 0, removed = 0;
  for (const id of ids) {
    const { rows: [m] } = await tx.execute(sql`SELECT id, fixed_limit FROM members WHERE id = ${id}`);
    if (!m) continue;
    const { rows: dues } = await tx.execute(sql`
      SELECT d.id, d.amount, d.paid_amount, d.base_amount, d.status::text AS status, d.paid_date
      FROM dues d JOIN members c ON c.id = d.closing_member_id
      WHERE d.payer_member_id = ${id}
      ORDER BY c.closing_date NULLS LAST, c.closing_at NULLS LAST, d.created_at, d.id
      FOR UPDATE OF d`); // a payment on one of them waits (and we see its paid amount)
    if (m.fixed_limit == null && !dues.some((d) => d.base_amount != null)) continue;
    const limit = m.fixed_limit == null ? Infinity : Number(m.fixed_limit);
    const paidAll = dues.reduce((a, d) => a + d.paid_amount, 0);
    let room = Math.max(limit - paidAll, 0);
    const today = fmtISO(todayIST());
    for (const d of dues) {
      const full = d.base_amount ?? d.amount;
      const more = Math.min(Math.max(full - d.paid_amount, 0), room);
      room -= more;
      const want = d.paid_amount + more;
      const base = want < full ? full : null;
      if (want === 0) {
        await tx.execute(sql`DELETE FROM dues WHERE id = ${d.id} AND paid_amount = 0`);
        removed++;
        continue;
      }
      if (want === d.amount && base === d.base_amount) continue;
      const status = d.paid_amount >= want ? "paid" : d.paid_amount > 0 ? "partial" : "pending";
      await tx.execute(sql`
        UPDATE dues SET amount = ${want}, base_amount = ${base}, status = ${status}::due_status,
          paid_date = ${status === "paid" ? fmtISO(d.paid_date) || today : null}::date,
          paid_at = ${status === "paid" ? sql`COALESCE(paid_at, now())` : sql`paid_at`},
          updated_at = now()
        WHERE id = ${d.id}`);
      changed++;
    }
  }
  return { changed, removed };
}

/** Limited members of a program who have a due for closing `closingId` (their share may move). */
export async function limitedPayersOf(tx, closingId) {
  const { rows } = await tx.execute(sql`
    SELECT DISTINCT p.id FROM dues d JOIN members p ON p.id = d.payer_member_id
    WHERE d.closing_member_id = ${closingId} AND (p.fixed_limit IS NOT NULL OR d.base_amount IS NOT NULL)`);
  return rows.map((r) => r.id);
}

/** Limited members of a program (whose dues may need to grow back after a closing is removed). */
export async function limitedMembers(tx, programId) {
  const { rows } = await tx.execute(sql`
    SELECT id FROM members m WHERE m.program_id = ${programId} AND NOT m.deleted
      AND (m.fixed_limit IS NOT NULL OR EXISTS (SELECT 1 FROM dues d WHERE d.payer_member_id = m.id AND d.base_amount IS NOT NULL))`);
  return rows.map((r) => r.id);
}

/** Where a member stands against his limit: { limit, paid, owed, advance, left, advanceRoom } (limit null = none). */
export async function limitStatus(memberId, runner = db) {
  const { rows: [r] } = await runner.execute(sql`
    SELECT m.fixed_limit,
      COALESCE((SELECT sum(paid_amount) FROM dues WHERE payer_member_id = m.id), 0)::int AS paid,
      COALESCE((SELECT sum(amount - paid_amount) FROM dues WHERE payer_member_id = m.id), 0)::int AS owed,
      COALESCE((SELECT sum(CASE WHEN kind IN ('deposit','return') THEN amount ELSE -amount END)
                FROM member_advances WHERE member_id = m.id AND status = 'completed'), 0)::int AS advance
    FROM members m WHERE m.id = ${memberId}`);
  if (!r) throw notFound("Member not found");
  const limit = r.fixed_limit == null ? null : Number(r.fixed_limit);
  return {
    limit, paid: r.paid, owed: r.owed, advance: r.advance,
    left: limit == null ? null : Math.max(limit - r.paid, 0),                 // still to pay in all
    advanceRoom: limit == null ? null : Math.max(limit - r.paid - r.advance, 0), // most advance he can still give
    reached: limit != null && r.paid >= limit,
  };
}

/**
 * Set (or remove: fixedLimit null) the fixed rakam of many members at once (bulk, Members page).
 * Optional `advance: { method: "cash", paymentDate, note }` → each member's advance is filled up to what
 * is left of his limit (left − advance already there), so he has nothing more to pay later.
 */
export async function setFixedLimit(programId, { memberIds = [], fixedLimit, advance = null } = {}, auth) {
  const ids = [...new Set((Array.isArray(memberIds) ? memberIds : []).filter(Boolean).map(String))];
  if (!ids.length) throw badRequest("Kam se kam ek sadasya chunein");
  if (ids.length > 2000) throw badRequest("Ek baar mein 2000 se zyada nahi");
  const limit = normLimit(fixedLimit);
  if (limit === undefined) throw badRequest("fixedLimit daalein (null = seema hatao)");
  const { lockProgram } = await import("./closings.js");
  const { resyncPayer } = await import("./closings.js");
  const list = sql.join(ids.map((x) => sql`${x}`), sql`, `);
  const changed = await db.transaction(async (tx) => {
    await lockProgram(tx, programId);
    const { rows } = await tx.execute(sql`
      SELECT id FROM members WHERE id IN (${list}) AND program_id = ${programId} AND NOT deleted ORDER BY id FOR UPDATE`);
    if (rows.length !== ids.length) throw badRequest("Kuch sadasya is yojna mein nahi mile (ya delete ho chuke)");
    await tx.execute(sql`UPDATE members SET fixed_limit = ${limit}, updated_at = now() WHERE id IN (${list})`);
    let removed = 0, added = 0;
    for (const id of ids) {
      const r = await resyncPayer(tx, id, { strict: false });
      added += r.added; removed += r.removed;
    }
    return { added, removed };
  });

  const advanceAdded = new Map();
  if (advance && limit != null) {
    const { addAdvance } = await import("./advances.js");
    for (const id of ids) {
      const st = await limitStatus(id);
      if (st.advanceRoom > 0) {
        await addAdvance(id, { amount: st.advanceRoom, method: advance.method || "cash", paymentDate: advance.paymentDate,
          note: advance.note || `Fixed rakam ₹${limit} — baki advance` }, auth);
        advanceAdded.set(id, st.advanceRoom);
      }
    }
  }
  const { rows: names } = await db.execute(sql`SELECT id, display_name, registration_number FROM members WHERE id IN (${list})`);
  const members = [];
  for (const n of names) {
    members.push({ id: n.id, displayName: n.display_name, registrationNumber: n.registration_number,
      ...(await limitStatus(n.id)), advanceAdded: advanceAdded.get(n.id) || 0 });
  }
  return {
    success: true, fixedLimit: limit, count: ids.length, members, duesRemoved: changed.removed, duesAdded: changed.added,
    advanceTotal: [...advanceAdded.values()].reduce((a, b) => a + b, 0),
  };
}
