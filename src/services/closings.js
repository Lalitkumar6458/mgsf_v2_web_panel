// Closing (marriage) logic. Replaces Cloud Functions onMemberMarriageUpdate,
// onNewMemberAcceptedSync and revertClosingMember. Everything runs inside one
// Postgres transaction, so there are no half-done states and no per-read cost.
//
// THE RULE (same as the old function + "Correct Payments" screen):
// payer P owes closing C (closing date D) when
//   - same program, P ≠ C
//   - P not deleted, active, not blocked, status accepted/closed
//   - P.dateJoin <= D
//   - P was not closed BEFORE D  (P.closingDate IS NULL OR P.closingDate >= D) — members closed on the same day owe each other
//   - P.payAmount > 0  (pay amount 0 = this member pays nothing)
import { sql, eq } from "drizzle-orm";
import { cancelCommissions } from "./commissions.js";
import { db, schema } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { toDate, todayIST, addDays, fmtISO } from "../lib/dates.js";
import { camel } from "../lib/case.js";

/** days a payer gets to pay a closing (programs.due_days, default 45) */
async function dueDays(tx, programId) {
  const { rows: [r] } = await tx.execute(sql`SELECT due_days FROM programs WHERE id = ${programId}`);
  return r?.due_days ?? 45;
}

/** SQL fragment: members of program `programId` eligible to pay a closing of member `closingId` on `closingDay`. */
const eligiblePayers = (programId, closingId, closingDay) => sql`
  SELECT p.id, p.pay_amount
  FROM members p
  WHERE p.program_id = ${programId}
    AND p.id <> ${closingId}
    AND NOT p.deleted AND p.active AND NOT p.blocked
    AND p.status IN ('accepted', 'closed')
    AND p.date_join <= ${closingDay}::date
    AND (p.closing_date IS NULL OR p.closing_date >= ${closingDay}::date)
    AND p.pay_amount > 0
    AND NOT (p.status = 'closed' AND p.closing_date IS NULL)`;

/**
 * One change to a program's dues at a time (closing record / edit / revert, member accept, join date
 * or pay amount change, delete). Without this, two of them at the same moment each miss the other's
 * uncommitted work (e.g. a member accepted while a closing is saved got no due for it).
 * Always taken BEFORE any member row lock (same order everywhere → no deadlock).
 */
export async function lockProgram(tx, programId) {
  if (programId) await tx.execute(sql`SELECT id FROM programs WHERE id = ${programId} FOR UPDATE`);
}

/** Program of a member, read without locking (to take the program lock first). */
export async function programOf(tx, memberId) {
  const { rows: [r] } = await tx.execute(sql`SELECT program_id FROM members WHERE id = ${memberId}`);
  if (!r) throw notFound("Member not found");
  return r.program_id;
}

/**
 * Is this due still owed by THE RULE's dates and status? (used after a payment is reversed: a due that
 * was only kept because money was in it goes away once the money is out). Blocked payers keep theirs.
 */
export async function dueStillOwed(tx, dueId) {
  const { rows: [r] } = await tx.execute(sql`
    SELECT (NOT p.deleted AND p.status IN ('accepted', 'closed') AND p.pay_amount > 0
            AND NOT c.deleted AND c.closing_date IS NOT NULL AND p.id <> c.id
            AND p.date_join <= c.closing_date
            AND (p.closing_date IS NULL OR p.closing_date >= c.closing_date)) AS owed
    FROM dues d JOIN members p ON p.id = d.payer_member_id JOIN members c ON c.id = d.closing_member_id
    WHERE d.id = ${dueId}`);
  return r ? !!r.owed : false;
}

async function lockMember(tx, memberId) {
  const { rows } = await tx.execute(sql`SELECT * FROM members WHERE id = ${memberId} FOR UPDATE`);
  if (!rows.length) throw notFound("Member not found");
  return rows[0];
}


/** Insert every missing due for one closing. Returns number of dues created. */
async function insertDuesForClosing(tx, m) {
  // due = (closing date, or the day it was recorded if later) + due days
  const days = await dueDays(tx, m.program_id);
  const res = await tx.execute(sql`
    INSERT INTO dues (id, program_id, closing_member_id, payer_member_id, amount, due_date)
    SELECT gen_random_uuid()::text, ${m.program_id}, ${m.id}, e.id,
           e.pay_amount,
           (SELECT GREATEST(c.closing_date, COALESCE((c.closing_at AT TIME ZONE 'Asia/Kolkata')::date, c.closing_date)) + ${days}::int
              FROM members c WHERE c.id = ${m.id})
    FROM (${eligiblePayers(m.program_id, m.id, m.closing_date)}) e
    ON CONFLICT (closing_member_id, payer_member_id) DO NOTHING`);
  return res.rowCount ?? 0;
}

/**
 * Record a marriage (closing) for a member and create all dues.
 * input: { closingDate, closingGroupId?, closingNotes?, invitationCardUrl?, pdfData? }
 */
export async function recordClosing(memberId, input) {
  const closingDay = fmtISO(toDate(input.closingDate));
  if (!closingDay) throw badRequest("Valid closingDate required (DD-MM-YYYY or YYYY-MM-DD)");

  return db.transaction(async (tx) => {
    await lockProgram(tx, await programOf(tx, memberId));
    const m = await lockMember(tx, memberId);
    if (m.deleted) throw badRequest("Member is deleted");
    if (m.closing_date) throw conflict("Member is already closed");
    if (m.status !== "accepted") throw badRequest(`Only accepted members can be closed (status: ${m.status})`);
    if (input.closingGroupId) await assertGroup(tx, m.program_id, input.closingGroupId);

    await tx.execute(sql`
      UPDATE members SET
        status = 'closed', closing_date = ${closingDay}::date, closing_at = now(),
        closing_group_id = ${input.closingGroupId || null},
        closing_notes = ${input.closingNotes || ""},
        invitation_card_url = ${input.invitationCardUrl || ""},
        pdf_data = ${input.pdfData ? JSON.stringify(input.pdfData) : null}::jsonb,
        updated_at = now()
      WHERE id = ${memberId}`);
    m.closing_date = closingDay;

    // A member closed on D no longer owes closings dated after D (only untouched pending dues are removed)
    const removed = await tx.execute(sql`
      DELETE FROM dues d USING members c
      WHERE d.payer_member_id = ${memberId} AND c.id = d.closing_member_id
        AND c.closing_date > ${closingDay}::date AND d.status = 'pending' AND d.paid_amount = 0`);

    const created = await insertDuesForClosing(tx, m);
    return { success: true, memberId, closingDate: closingDay, duesCreated: created, ownDuesRemoved: removed.rowCount ?? 0 };
  });
}

/** Edit closing details. If the date changes, dues of this closing are re-synced (paid dues are never touched). */
export async function updateClosing(memberId, input) {
  return db.transaction(async (tx) => {
    await lockProgram(tx, await programOf(tx, memberId));
    const m = await lockMember(tx, memberId);
    if (!m.closing_date) throw badRequest("Member is not closed");
    const newDay = input.closingDate ? fmtISO(toDate(input.closingDate)) : m.closing_date;
    if (!newDay) throw badRequest("Invalid closingDate");
    if (input.closingGroupId) await assertGroup(tx, m.program_id, input.closingGroupId);

    await tx.execute(sql`
      UPDATE members SET
        closing_date = ${newDay}::date,
        closing_group_id = ${input.closingGroupId === undefined ? m.closing_group_id : input.closingGroupId || null},
        closing_notes = ${input.closingNotes ?? m.closing_notes},
        invitation_card_url = ${input.invitationCardUrl ?? m.invitation_card_url},
        pdf_data = ${input.pdfData !== undefined ? JSON.stringify(input.pdfData) : m.pdf_data ? JSON.stringify(m.pdf_data) : null}::jsonb,
        updated_at = now()
      WHERE id = ${memberId}`);

    let added = 0, removed = 0, asPayer = null;
    if (newDay !== fmtISO(m.closing_date)) {
      m.closing_date = newDay;
      // money already received from payers who would no longer owe this closing → refuse
      const { rows: paidOut } = await tx.execute(sql`
        SELECT p.display_name, p.registration_number, d.paid_amount
        FROM dues d JOIN members p ON p.id = d.payer_member_id
        WHERE d.closing_member_id = ${memberId} AND d.paid_amount > 0
          AND (p.date_join > ${newDay}::date OR (p.closing_date IS NOT NULL AND p.id <> ${memberId} AND p.closing_date < ${newDay}::date))`);
      if (paidOut.length) {
        const list = paidOut.slice(0, 5).map((x) => `${x.display_name} (₹${x.paid_amount})`).join(", ");
        throw conflict(`Closing date ${newDay} nahi ho sakti: ${paidOut.length} members ka paisa jama hai jo is date par member hi nahi the — ${list}. Pehle wo payment reverse karein.`);
      }
      const r = await tx.execute(sql`
        DELETE FROM dues d
        WHERE d.closing_member_id = ${memberId} AND d.status = 'pending' AND d.paid_amount = 0
          AND d.payer_member_id NOT IN (SELECT id FROM (${eligiblePayers(m.program_id, memberId, newDay)}) e)`);
      removed = r.rowCount ?? 0;
      // unpaid dues of this closing: new closing date + due days
      await tx.execute(sql`
        UPDATE dues SET updated_at = now(), due_date = (
          SELECT GREATEST(c.closing_date, COALESCE((c.closing_at AT TIME ZONE 'Asia/Kolkata')::date, c.closing_date)) + ${await dueDays(tx, m.program_id)}::int
          FROM members c WHERE c.id = ${memberId})
        WHERE closing_member_id = ${memberId} AND status <> 'paid'`);
      added = await insertDuesForClosing(tx, m);
      // his own dues as a payer: owes closings before his (new) closing date only
      asPayer = await resyncPayer(tx, memberId, { strict: true });
    }
    return {
      success: true, memberId, closingDate: newDay, duesAdded: added, duesRemoved: removed,
      ownDuesAdded: asPayer?.added || 0, ownDuesRemoved: asPayer?.removed || 0,
    };
  });
}

/**
 * Undo a closing (old revertClosingMember, with its bugs fixed):
 *  - deletes the dues OF this closing; if some are already paid it refuses unless force=true,
 *    in which case their transactions are marked "reversed" (kept for audit, not deleted)
 *  - does NOT delete the member's own dues for other closings (old step 4 deleted even paid ones)
 *  - member goes back to accepted and gets dues for closings he owes again (dated after his old closing date)
 */
export async function revertClosing(memberId, { force = false } = {}) {
  return db.transaction(async (tx) => {
    await lockProgram(tx, await programOf(tx, memberId));
    const m = await lockMember(tx, memberId);
    if (!m.closing_date) throw badRequest("Member is not closed");

    const { rows: [paid] } = await tx.execute(sql`
      SELECT count(*)::int AS n, COALESCE(sum(paid_amount), 0)::int AS amount
      FROM dues WHERE closing_member_id = ${memberId} AND paid_amount > 0`);
    if (paid.n > 0 && !force) {
      throw conflict(`${paid.n} payments (₹${paid.amount}) are already received for this closing.`, paid);
    }

    const reversed = await tx.execute(sql`
      UPDATE transactions SET status = 'reversed', due_id = NULL, updated_at = now(),
        extra = extra || jsonb_build_object('reversedReason', 'closing reverted', 'reversedAt', now())
      WHERE closing_member_id = ${memberId} AND status = 'completed'`);
    if ((reversed.rowCount ?? 0) > 0) {
      await cancelCommissions(tx, "closing",
        sql`c.source_id IN (SELECT id FROM transactions WHERE closing_member_id = ${memberId} AND status = 'reversed')`,
        "Closing reverted");
    }
    const deleted = await tx.execute(sql`DELETE FROM dues WHERE closing_member_id = ${memberId}`);

    await tx.execute(sql`
      UPDATE members SET status = 'accepted', closing_date = NULL, closing_at = NULL, closing_group_id = NULL,
        closing_notes = '', invitation_card_url = '', pdf_data = NULL, updated_at = now(),
        extra = extra || jsonb_build_object('revertedAt', now())
      WHERE id = ${memberId}`);

    // He owes closings dated after his (now cancelled) closing date again
    // He owes closings dated after his (now cancelled) closing date again — same rule as everyone
    const resynced = (await resyncPayer(tx, memberId, { strict: false })).added;

    return {
      success: true,
      deletedDues: deleted.rowCount ?? 0,
      reversedTransactions: reversed.rowCount ?? 0,
      duesRecreatedAsPayer: resynced,
    };
  });
}

/** Called after a member becomes accepted: he owes every closing the rule says (by his join date). */
export async function syncNewlyAccepted(tx, memberId) {
  const r = await resyncPayer(tx, memberId, { strict: false });
  return r.added;
}

/** Closings that payer `p` owes by dates (join date ≤ closing date < his own closing date). Alias c. */
const payerClosingsSql = (p) => sql`
  SELECT c.id FROM members c
  WHERE c.program_id = ${p.program_id} AND c.id <> ${p.id} AND c.closing_date IS NOT NULL AND NOT c.deleted
    AND c.closing_date >= ${fmtISO(p.date_join)}::date
    ${p.closing_date ? sql`AND c.closing_date <= ${fmtISO(p.closing_date)}::date` : sql``}`;

/**
 * Make one payer's dues match THE RULE (after accept, join date change, own closing date change …):
 *  - closings he now owes and has no due for → due created (only if he is active, not blocked)
 *  - dues he no longer owes by date and nothing is paid → deleted
 *  - dues he no longer owes but money is already received → strict: refuse the change (error lists them);
 *    not strict: left as they are and returned in `paidKept`
 */
export async function resyncPayer(tx, memberId, { strict = true } = {}) {
  const { rows: [p] } = await tx.execute(sql`SELECT * FROM members WHERE id = ${memberId}`);
  if (!p || p.deleted || !["accepted", "closed"].includes(p.status) || !p.date_join) return { added: 0, removed: 0, paidKept: [] };
  const owe = payerClosingsSql(p);

  const { rows: paidKept } = await tx.execute(sql`
    SELECT d.id, d.paid_amount, c.display_name, c.registration_number, c.closing_date
    FROM dues d JOIN members c ON c.id = d.closing_member_id
    WHERE d.payer_member_id = ${p.id} AND d.paid_amount > 0 AND d.closing_member_id NOT IN (${owe})
    ORDER BY c.closing_date`);
  if (strict && paidKept.length) {
    const list = paidKept.slice(0, 5).map((d) => `${d.display_name} (${fmtISO(d.closing_date)}, ₹${d.paid_amount} paid)`).join(", ");
    throw conflict(`Ye badlav nahi ho sakta: ${paidKept.length} closing ka paisa pehle se jama hai jo nayi date ke hisaab se banta hi nahi — ${list}. Pehle wo payment reverse karein.`, { paidDues: camel(paidKept) });
  }
  // pay amount 0 → he pays nothing: every untouched pending due goes
  const removed = await tx.execute(sql`
    DELETE FROM dues d WHERE d.payer_member_id = ${p.id} AND d.paid_amount = 0 AND d.status = 'pending'
      ${p.pay_amount > 0 ? sql`AND d.closing_member_id NOT IN (${owe})` : sql``}`);

  let added = 0;
  if (p.active && !p.blocked && p.pay_amount > 0) {
    // a closing he owes from the past (late accept / join date moved) gets the full period from today
    const days = await dueDays(tx, p.program_id);
    const res = await tx.execute(sql`
      INSERT INTO dues (id, program_id, closing_member_id, payer_member_id, amount, due_date)
      SELECT gen_random_uuid()::text, ${p.program_id}, c.id, ${p.id}, ${p.pay_amount},
        GREATEST(c.closing_date, ${fmtISO(todayIST())}::date) + ${days}::int
      FROM members c WHERE c.id IN (${owe})
      ON CONFLICT (closing_member_id, payer_member_id) DO NOTHING`);
    added = res.rowCount ?? 0;
  }
  return { added, removed: removed.rowCount ?? 0, paidKept: camel(paidKept) };
}

/**
 * Join date changed (Edit Member). Runs inside the caller's transaction; refuses if money already
 * received for a closing the member would no longer owe.
 */
export async function onJoinDateChanged(tx, memberId) {
  return resyncPayer(tx, memberId, { strict: true });
}

async function assertGroup(tx, programId, groupId) {
  const g = await tx.query.closingGroups.findFirst({ where: eq(schema.closingGroups.id, groupId) });
  if (!g || g.programId !== programId) throw badRequest("Closing group not found in this program");
}

/**
 * "Correct Payments": compare a payer's dues with THE RULE.
 * Returns { missing: [closing…], extra: [due…] }. Nothing is changed.
 */
export async function payerDuesCheck(memberId) {
  const { rows: [p] } = await db.execute(sql`SELECT * FROM members WHERE id = ${memberId}`);
  if (!p) throw notFound("Member not found");
  const eligibleSql = sql`
    SELECT c.id FROM members c
    WHERE c.program_id = ${p.program_id} AND c.id <> ${p.id} AND c.closing_date IS NOT NULL AND NOT c.deleted
      AND c.closing_date >= ${fmtISO(p.date_join)}::date
      ${p.closing_date ? sql`AND c.closing_date <= ${fmtISO(p.closing_date)}::date` : sql``}`;
  const canOwe = !p.deleted && p.active && !p.blocked && p.pay_amount > 0 && ["accepted", "closed"].includes(p.status);

  const { rows: missing } = canOwe
    ? await db.execute(sql`
        SELECT c.id AS closing_member_id, c.display_name, c.registration_number, c.closing_date
        FROM members c
        WHERE c.id IN (${eligibleSql})
          AND NOT EXISTS (SELECT 1 FROM dues d WHERE d.closing_member_id = c.id AND d.payer_member_id = ${p.id})
        ORDER BY c.closing_date`)
    : { rows: [] };
  const { rows: extra } = await db.execute(sql`
    SELECT d.id AS due_id, d.status, d.paid_amount, d.closing_member_id, c.display_name, c.closing_date
    FROM dues d JOIN members c ON c.id = d.closing_member_id
    WHERE d.payer_member_id = ${p.id}
      AND ${canOwe ? sql`d.closing_member_id NOT IN (${eligibleSql})` : sql`TRUE`}
    ORDER BY c.closing_date`);
  return { memberId, missing: camel(missing), extra: camel(extra) };
}

/** Apply corrections chosen by the admin: add dues for closingIds, delete pending dueIds (paid/partial are never deleted). */
export async function applyPayerCorrection(memberId, { addClosingIds = [], removeDueIds = [] }) {
  return db.transaction(async (tx) => {
    await lockProgram(tx, await programOf(tx, memberId));
    const p = await lockMember(tx, memberId);
    const days = await dueDays(tx, p.program_id);
    let added = 0, removed = 0;
    if (addClosingIds.length && !(p.pay_amount > 0)) throw badRequest("Is member ki pay amount ₹0 hai — use koi closing payment nahi dena");
    if (addClosingIds.length) {
      const r = await tx.execute(sql`
        INSERT INTO dues (id, program_id, closing_member_id, payer_member_id, amount, due_date, added_manually)
        SELECT gen_random_uuid()::text, c.program_id, c.id, ${p.id}, ${p.pay_amount}, GREATEST(c.closing_date, ${fmtISO(todayIST())}::date) + ${days}::int, true
        FROM members c
        WHERE c.id IN (${sql.join(addClosingIds.map((x) => sql`${x}`), sql`, `)})
          AND c.program_id = ${p.program_id} AND c.closing_date IS NOT NULL AND c.id <> ${p.id}
        ON CONFLICT (closing_member_id, payer_member_id) DO NOTHING`);
      added = r.rowCount ?? 0;
    }
    if (removeDueIds.length) {
      const r = await tx.execute(sql`
        DELETE FROM dues WHERE payer_member_id = ${p.id} AND status = 'pending' AND paid_amount = 0
          AND id IN (${sql.join(removeDueIds.map((x) => sql`${x}`), sql`, `)})`);
      removed = r.rowCount ?? 0;
    }
    return { success: true, added, removed };
  });
}

/** Closing list with payment progress (old closing-members / closing-payment-status routes). */
/**
 * agentId        → count only dues of that agent's payers (agent app)
 * closingAgentId → only closings whose member belongs to that agent (Closed Members page filter)
 */
export async function listClosings(programId, { agentId, closingAgentId, closingGroupId, from, to } = {}) {
  // per-closing totals come from the covering index dues_closing_cover_idx (no table reads)
  const { rows } = await db.execute(sql`
    SELECT c.id, c.display_name, c.father_name, c.registration_number, c.application_number,
           c.village, c.phone, c.photo_url, c.guardian, c.guardian_relation, c.closing_date, c.closing_at,
           c.closing_group_id, g.name AS closing_group_name, c.agent_id, a.display_name AS agent_name, a.phone AS agent_phone,
           c.district, c.state, c.date_join, c.gender, c.closing_notes,
           COALESCE(x.total_dues, 0)::int       AS total_dues,
           COALESCE(x.paid, 0)::int             AS paid,
           COALESCE(x.partial, 0)::int          AS partial,
           COALESCE(x.pending, 0)::int          AS pending,
           COALESCE(x.collected_amount, 0)::int AS collected_amount,
           COALESCE(x.pending_amount, 0)::int   AS pending_amount
    FROM members c
    LEFT JOIN closing_groups g ON g.id = c.closing_group_id
    LEFT JOIN agents a ON a.id = c.agent_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS total_dues,
             count(*) FILTER (WHERE d.status = 'paid')    AS paid,
             count(*) FILTER (WHERE d.status = 'partial') AS partial,
             count(*) FILTER (WHERE d.status = 'pending') AS pending,
             sum(d.paid_amount)                           AS collected_amount,
             sum(d.amount - d.paid_amount)                AS pending_amount
      FROM dues d
      WHERE d.closing_member_id = c.id
        ${agentId ? sql`AND d.payer_member_id IN (SELECT id FROM members WHERE agent_id = ${agentId})` : sql``}
    ) x ON true
    WHERE c.program_id = ${programId} AND c.closing_date IS NOT NULL AND NOT c.deleted
      ${closingGroupId === "none" ? sql`AND c.closing_group_id IS NULL` : closingGroupId ? sql`AND c.closing_group_id = ${closingGroupId}` : sql``}
      ${closingAgentId === "none" ? sql`AND c.agent_id IS NULL` : closingAgentId ? sql`AND c.agent_id = ${closingAgentId}` : sql``}
      ${from ? sql`AND c.closing_date >= ${fmtISO(toDate(from))}::date` : sql``}
      ${to ? sql`AND c.closing_date <= ${fmtISO(toDate(to))}::date` : sql``}
    ORDER BY c.closing_date DESC, c.closing_at DESC NULLS LAST`);

  const summary = { totalClosings: rows.length, totalPaidCount: 0, totalPendingCount: 0, totalCollected: 0, totalPendingAmount: 0 };
  for (const r of rows) {
    summary.totalPaidCount += r.paid;
    summary.totalPendingCount += r.pending + r.partial;
    summary.totalCollected += r.collected_amount;
    summary.totalPendingAmount += r.pending_amount;
    r.completion_pct = r.total_dues ? Math.round((r.paid / r.total_dues) * 100) : 0;
  }
  return { closings: camel(rows), summary };
}

/** Everyone who owes one closing, with payer details (old payment_pending where closingMemberId == X). */
export async function closingDues(closingId, { agentId, status } = {}) {
  const { rows } = await db.execute(sql`
    SELECT d.id, d.status::text AS status, d.amount, d.paid_amount, d.due_date, d.paid_at, d.payment_method,
           d.online_reference, d.added_manually, d.closing_member_id, d.payer_member_id,
           p.display_name AS payer_name, p.father_name AS payer_father_name, p.registration_number AS payer_reg_no,
           p.application_number AS payer_application_number, p.phone AS payer_phone, p.village AS payer_village,
           p.district AS payer_district, p.photo_url AS payer_photo, p.agent_id, p.added_by_name, p.date_join AS payer_date_join,
           p.status::text AS payer_status
    FROM dues d JOIN members p ON p.id = d.payer_member_id
    WHERE d.closing_member_id = ${closingId}
      ${agentId ? sql`AND p.agent_id = ${agentId}` : sql``}
      ${status ? sql`AND d.status = ${status}::due_status` : sql``}
    ORDER BY (d.status = 'paid'), p.display_name`);
  const summary = rows.reduce((s, d) => {
    s.total++; s.totalAmount += d.amount; s.paidAmount += d.paid_amount;
    if (d.status === "paid") s.paid++; else s.pending++;
    return s;
  }, { total: 0, paid: 0, pending: 0, totalAmount: 0, paidAmount: 0 });
  summary.pendingAmount = summary.totalAmount - summary.paidAmount;
  return { dues: camel(rows), summary };
}
