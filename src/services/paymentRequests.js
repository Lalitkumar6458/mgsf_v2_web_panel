// App payment requests ("भुगतान का अनुरोध"). A member (for himself / his family) or an agent (for his
// member) pays the trust on its UPI QR / bank account, then sends from the app: what it was for
// (closings, joining fee), amount, UTR and a screenshot. The office checks it in the panel:
//   approve → a normal payment is written in ONE transaction: dues paid (oldest closing first, then
//             joining fee), transactions with the UTR, agent commission, receipt; money left over can go
//             to the member's advance. The member then sees "जमा" instead of "बाकी".
//   reject  → with a reason; nothing is written. The person sees the reason in the app.
// Feature-control switch: paymentRequests.
import { sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../db/index.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { toDate, todayIST, fmtISO } from "../lib/dates.js";
import { camel } from "../lib/case.js";
import { memberFor } from "./mobileApp.js";
import { assertNewReference, lockOpenDues, writePayments } from "./payments.js";
import { joinFeeTx } from "./joinFees.js";
import { accrueJoinFeesFor } from "./commissions.js";
import { limitStatus } from "./fixedLimit.js";

export const REQUEST_METHODS = ["upi", "bank", "online"];
const inList = (ids) => sql.join(ids.map((x) => sql`${x}`), sql`, `);
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

function whole(v, what = "राशि") {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) throw badRequest(`${what} पूरे रुपये में डालें`);
  if (n > 10000000) throw badRequest(`${what} बहुत ज़्यादा है`);
  return n;
}
const cleanRef = (v) => String(v || "").replace(/\s+/g, "").toUpperCase().slice(0, 40);

/** UTR already used — a completed payment of this trust, or another open / approved request. */
async function referenceUsed(runner, adminId, ref, exceptId = null) {
  if (!ref) return null;
  const { rows: [t] } = await runner.execute(sql`
    SELECT t.transaction_number FROM transactions t JOIN programs p ON p.id = t.program_id
    WHERE p.admin_id = ${adminId} AND t.status = 'completed' AND upper(t.online_reference) = ${ref} LIMIT 1`);
  if (t) return `इस UTR (${ref}) से भुगतान पहले से जमा है`;
  const { rows: [r] } = await runner.execute(sql`
    SELECT request_no, status FROM payment_requests
    WHERE admin_id = ${adminId} AND reference = ${ref} AND status IN ('pending', 'approved') ${exceptId ? sql`AND id <> ${exceptId}` : sql``} LIMIT 1`);
  if (r) return `इस UTR (${ref}) का अनुरोध ${r.request_no} पहले से ${r.status === "approved" ? "जमा हो चुका है" : "भेजा जा चुका है"}`;
  return null;
}

/**
 * Normalise the "what for" list against the database (only open dues of that member, fee not more than due).
 * → [{ memberId, programId, name, regNo, agentId, dueIds, dueAmount, joinFee }]
 */
async function checkItems(runner, items, { strictOwner = null } = {}) {
  const out = [];
  for (const it of items) {
    const memberId = String(it?.memberId || "");
    if (!memberId) continue;
    const m = strictOwner ? await memberFor(strictOwner, memberId) : (await runner.execute(sql`
      SELECT m.*, p.admin_id FROM members m JOIN programs p ON p.id = m.program_id WHERE m.id = ${memberId}`)).rows[0];
    if (!m) throw notFound("सदस्य नहीं मिला");
    const want = [...new Set((Array.isArray(it.dueIds) ? it.dueIds : []).map(String))].slice(0, 500);
    let dues = [];
    if (want.length) {
      ({ rows: dues } = await runner.execute(sql`
        SELECT d.id, d.amount - d.paid_amount AS remaining FROM dues d
        WHERE d.payer_member_id = ${memberId} AND d.status IN ('pending', 'partial') AND d.id IN (${inList(want)})`));
    }
    const feeDue = Math.max(Number(m.join_fees || 0) - Number(m.join_fees_paid_amount || 0), 0);
    const joinFee = Math.min(Math.max(Math.round(Number(it.joinFee) || 0), 0), feeDue);
    if (!dues.length && !joinFee) continue;
    out.push({
      memberId, programId: m.program_id, name: m.display_name, regNo: m.registration_number || "", agentId: m.agent_id || null,
      dueIds: dues.map((d) => d.id), dueAmount: dues.reduce((a, d) => a + Number(d.remaining), 0), joinFee,
    });
  }
  return out;
}

/** App: send a request. body: { items:[{memberId, dueIds, joinFee}], amount, method, reference, paymentDate, screenshotUrl, note } */
export async function createRequest(auth, body = {}) {
  if (!["member", "agent"].includes(auth.role)) throw forbidden("सिर्फ़ सदस्य / एजेंट ऐप से");
  const amount = whole(body.amount);
  const method = REQUEST_METHODS.includes(String(body.method)) ? String(body.method) : "upi";
  const reference = cleanRef(body.reference);
  if (reference.length < 6) throw badRequest("UTR / Ref नंबर डालें (UPI ऐप की रसीद में मिलता है)");
  const day = fmtISO(toDate(body.paymentDate) || todayIST());
  if (day > fmtISO(todayIST())) throw badRequest("आगे की तारीख नहीं चुन सकते");
  const screenshotUrl = String(body.screenshotUrl || "").slice(0, 1000);
  const items = await checkItems(db, Array.isArray(body.items) ? body.items.slice(0, 30) : [], { strictOwner: auth });
  if (!items.length) throw badRequest("कौन-सी क्लोजिंग / शुल्क का भुगतान है, चुनें — या वह पहले ही जमा है");

  return db.transaction(async (tx) => {
    // one at a time per trust: two phones sending the same UTR at once
    await tx.execute(sql`SELECT id FROM admins WHERE id = ${auth.adminId} FOR UPDATE`);
    const used = await referenceUsed(tx, auth.adminId, reference);
    if (used) throw conflict(used);
    const dueIds = items.flatMap((i) => i.dueIds);
    if (dueIds.length) {
      const { rows: [busy] } = await tx.execute(sql`
        SELECT request_no FROM payment_requests r, jsonb_array_elements(r.items) it, jsonb_array_elements_text(it->'dueIds') did
        WHERE r.admin_id = ${auth.adminId} AND r.status = 'pending' AND did IN (${inList(dueIds)}) LIMIT 1`);
      if (busy) throw conflict(`इनमें से कुछ क्लोजिंग का अनुरोध ${busy.request_no} पहले से जाँच में है`);
    }
    const expected = items.reduce((a, i) => a + i.dueAmount + i.joinFee, 0);
    const no = `PR-${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}-${randomBytes(2).toString("hex").toUpperCase()}`;
    const { rows: [r] } = await tx.execute(sql`
      INSERT INTO payment_requests (id, admin_id, request_no, requested_by_role, requested_by_account_id, requested_by_name, agent_id,
        amount, expected_amount, method, reference, payment_date, screenshot_url, note, items)
      VALUES (gen_random_uuid()::text, ${auth.adminId}, ${no}, ${auth.role}, ${auth.accountId || ""}, ${auth.displayName || ""},
        ${auth.role === "agent" ? auth.agentId : items[0].agentId}, ${amount}, ${expected}, ${method}, ${reference}, ${day}::date,
        ${screenshotUrl}, ${String(body.note || "").slice(0, 300)},
        ${JSON.stringify(items.map((i) => ({ memberId: i.memberId, programId: i.programId, name: i.name, regNo: i.regNo, dueIds: i.dueIds, dueAmount: i.dueAmount, joinFee: i.joinFee })))}::jsonb)
      RETURNING *`);
    return { success: true, request: camel(r), warning: amount !== expected ? `चुनी हुई राशि ${inr(expected)} है, आपने ${inr(amount)} लिखा — कार्यालय जाँच करेगा` : "" };
  });
}

/** App: my requests (newest first). */
export async function myRequests(auth, { limit = 50 } = {}) {
  const { rows } = await db.execute(sql`
    SELECT * FROM payment_requests WHERE admin_id = ${auth.adminId} AND requested_by_account_id = ${auth.accountId || "-"}
    ORDER BY created_at DESC LIMIT ${Math.min(Number(limit) || 50, 200)}`);
  return { requests: camel(rows) };
}

/** App: take back a request the office has not looked at yet. */
export async function cancelRequest(auth, id) {
  const { rows: [r] } = await db.execute(sql`
    UPDATE payment_requests SET status = 'cancelled', updated_at = now()
    WHERE id = ${id} AND admin_id = ${auth.adminId} AND requested_by_account_id = ${auth.accountId || "-"} AND status = 'pending'
    RETURNING id`);
  if (!r) throw conflict("यह अनुरोध अब रद्द नहीं हो सकता");
  return { success: true };
}

/** Due ids that are in a pending request (the app shows them as "जाँच में", not to pay again). */
export async function pendingDueIds(adminId, memberIds) {
  if (!memberIds?.length) return new Set();
  const { rows } = await db.execute(sql`
    SELECT DISTINCT did FROM payment_requests r, jsonb_array_elements(r.items) it, jsonb_array_elements_text(it->'dueIds') did
    WHERE r.admin_id = ${adminId} AND r.status = 'pending' AND it->>'memberId' IN (${inList(memberIds)})`);
  return new Set(rows.map((x) => x.did));
}

/* ── panel ─────────────────────────────────────────────────────────────── */

export async function listRequests(adminId, { status = "pending", q = "", page = 1, pageSize = 50 } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const like = q ? `%${String(q).trim()}%` : null;
  const { rows } = await db.execute(sql`
    SELECT r.*, count(*) OVER()::int AS total_count FROM payment_requests r
    WHERE r.admin_id = ${adminId} ${status && status !== "all" ? sql`AND r.status = ${status}` : sql``}
      ${like ? sql`AND (r.reference ILIKE ${like} OR r.request_no ILIKE ${like} OR r.requested_by_name ILIKE ${like} OR r.items::text ILIKE ${like})` : sql``}
    ORDER BY ${status === "pending" ? sql`r.created_at ASC` : sql`r.created_at DESC`}
    LIMIT ${size} OFFSET ${(Math.max(Number(page) || 1, 1) - 1) * size}`);
  const { rows: counts } = await db.execute(sql`
    SELECT status, count(*)::int AS n FROM payment_requests WHERE admin_id = ${adminId} GROUP BY status`);
  const total = rows[0]?.total_count || 0;
  rows.forEach((r) => delete r.total_count);
  return { requests: camel(rows), total, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
}

export const pendingCount = async (adminId) =>
  (await db.execute(sql`SELECT count(*)::int AS n FROM payment_requests WHERE admin_id = ${adminId} AND status = 'pending'`)).rows[0].n;

/** One request with today's state of every member / due in it (what approving would pay). */
export async function requestDetail(adminId, id) {
  const { rows: [r] } = await db.execute(sql`SELECT * FROM payment_requests WHERE id = ${id} AND admin_id = ${adminId}`);
  if (!r) throw notFound("अनुरोध नहीं मिला");
  const members = [];
  for (const it of r.items || []) {
    const { rows: [m] } = await db.execute(sql`
      SELECT m.id, m.display_name, m.registration_number, m.father_name, m.village, m.phone, m.program_id, p.name AS program_name,
             m.join_fees, m.join_fees_paid_amount, m.agent_id, a.display_name AS agent_name, m.deleted
      FROM members m JOIN programs p ON p.id = m.program_id LEFT JOIN agents a ON a.id = m.agent_id WHERE m.id = ${it.memberId}`);
    if (!m) continue;
    const { rows: dues } = await db.execute(sql`
      SELECT d.id, d.amount, d.paid_amount, d.status::text AS status, d.due_date, c.display_name AS closing_name,
             c.registration_number AS closing_reg_no, c.closing_date, g.name AS group_name,
             (d.id IN (${inList(it.dueIds?.length ? it.dueIds : ["-"])})) AS requested
      FROM dues d JOIN members c ON c.id = d.closing_member_id LEFT JOIN closing_groups g ON g.id = c.closing_group_id
      WHERE d.payer_member_id = ${m.id} AND (d.status <> 'paid' OR d.id IN (${inList(it.dueIds?.length ? it.dueIds : ["-"])}))
      ORDER BY c.closing_date, c.closing_at`);
    members.push({
      ...camel(m), requestedJoinFee: it.joinFee || 0,
      joinFeeDue: Math.max(Number(m.join_fees || 0) - Number(m.join_fees_paid_amount || 0), 0),
      dues: camel(dues).map((d) => ({ ...d, remaining: d.status === "paid" ? 0 : d.amount - d.paidAmount })),
    });
  }
  const dup = r.status === "pending" ? await referenceUsed(db, adminId, r.reference, r.id) : null;
  return { request: camel(r), members, duplicate: dup };
}

/**
 * Approve. body (all optional — defaults are the request's own):
 *   { amount, paymentDate, reference, method, items:[{memberId, dueIds, joinFee}], extraToAdvance, note }
 * Money goes oldest closing first, member by member, then each member's joining fee. Money left over →
 * advance of the first member (extraToAdvance) or refused.
 */
export async function approveRequest(adminId, id, body = {}, auth) {
  return db.transaction(async (tx) => {
    const { rows: [r] } = await tx.execute(sql`SELECT * FROM payment_requests WHERE id = ${id} AND admin_id = ${adminId} FOR UPDATE`);
    if (!r) throw notFound("अनुरोध नहीं मिला");
    if (r.status !== "pending") throw conflict(`अनुरोध पहले से ${r.status === "approved" ? "स्वीकार" : r.status === "rejected" ? "अस्वीकार" : "रद्द"} है`);
    const amount = body.amount !== undefined ? whole(body.amount) : r.amount;
    const reference = body.reference !== undefined ? cleanRef(body.reference) : r.reference;
    const method = REQUEST_METHODS.includes(String(body.method)) ? String(body.method) : r.method;
    const paymentDate = fmtISO(toDate(body.paymentDate) || toDate(r.payment_date) || todayIST());
    const used = await referenceUsed(tx, adminId, reference, r.id);
    if (used) throw conflict(used);
    const items = await checkItems(tx, Array.isArray(body.items) ? body.items : r.items);

    let left = amount;
    const byProgram = new Map(); // programId → [{ due, pay }]
    const fees = [];             // { programId, memberId, amount }
    for (const it of items) {
      if (it.dueIds.length) {
        const open = await lockOpenDues(tx, it.programId, sql`d.payer_member_id = ${it.memberId} AND d.id IN (${inList(it.dueIds)})`);
        for (const due of open) {
          if (left <= 0) break;
          const pay = Math.min(left, due.amount - due.paid_amount);
          if (pay <= 0) continue;
          if (!byProgram.has(it.programId)) byProgram.set(it.programId, []);
          byProgram.get(it.programId).push({ due, pay });
          left -= pay;
        }
      }
    }
    for (const it of items) { // joining fee after the closings
      if (left <= 0 || !it.joinFee) continue;
      const pay = Math.min(left, it.joinFee);
      fees.push({ programId: it.programId, memberId: it.memberId, amount: pay });
      left -= pay;
    }
    if (!byProgram.size && !fees.length) throw conflict("इस अनुरोध में अब कुछ बाकी नहीं — सब पहले से जमा है। अनुरोध अस्वीकार करें।");

    let advance = null;
    if (left > 0) {
      if (!body.extraToAdvance) throw badRequest(`${inr(left)} ज़्यादा है (चुनी हुई राशि से) — रकम कम करें या "बचा पैसा advance में" चुनें`);
      if (auth?.features?.advancePayment === false) throw badRequest("Advance payment is panel mein chalu nahi hai — rakam kam karein");
      const to = items[0];
      await tx.execute(sql`SELECT id FROM members WHERE id = ${to.memberId} FOR UPDATE`);
      const lim = await limitStatus(to.memberId, tx);
      if (lim.limit != null && left > lim.advanceRoom) throw badRequest(`${to.name} की fixed rakam ${inr(lim.limit)} है — advance में सिर्फ़ ${inr(lim.advanceRoom)} जा सकता है`);
      await tx.execute(sql`
        INSERT INTO member_advances (id, program_id, member_id, kind, amount, method, payment_date, reference, note, agent_id, created_by_id, created_by_name)
        VALUES (gen_random_uuid()::text, ${to.programId}, ${to.memberId}, 'deposit', ${left}, ${method === "bank" ? "bank" : method}, ${paymentDate}::date,
          ${reference}, ${`App अनुरोध ${r.request_no}`}, ${to.agentId}, ${auth?.accountId || ""}, ${auth?.displayName || "Admin"})`);
      advance = { memberId: to.memberId, amount: left };
      left = 0;
    }

    const meta = { paymentMethod: method, paymentDate, note: `App अनुरोध ${r.request_no}${body.note ? ` · ${String(body.note).slice(0, 200)}` : ""}`, onlineReference: reference };
    const batches = [];
    let closingAmount = 0;
    for (const [programId, list] of byProgram) {
      await assertNewReference(tx, programId, reference);
      const w = await writePayments(tx, programId, list, meta, auth, "app_request");
      batches.push({ programId, batchId: w.batchId, amount: w.totalPaid, closings: w.processed });
      closingAmount += w.totalPaid;
    }
    const feeIds = [];
    for (const f of fees) {
      feeIds.push(await joinFeeTx(tx, f.programId, f.memberId, f.amount,
        { paymentMode: "online", transactionId: reference, paymentDate, note: `App अनुरोध ${r.request_no}`, createdByName: auth?.displayName || "Admin" }, auth));
    }
    if (feeIds.length) await accrueJoinFeesFor(tx, feeIds);
    const result = { batches, closingAmount, joinFeeAmount: fees.reduce((a, f) => a + f.amount, 0), advance, receivedAmount: amount };
    await tx.execute(sql`
      UPDATE payment_requests SET status = 'approved', reviewed_by_id = ${auth?.accountId || ""}, reviewed_by_name = ${auth?.displayName || "Admin"},
        reviewed_at = now(), updated_at = now(), result = ${JSON.stringify(result)}::jsonb,
        amount = ${amount}, reference = ${reference}, method = ${method}, payment_date = ${paymentDate}::date
      WHERE id = ${r.id}`);
    return { success: true, requestNo: r.request_no, accountId: r.requested_by_account_id, requestedByRole: r.requested_by_role, ...result };
  });
}

export async function rejectRequest(adminId, id, { reason = "" } = {}, auth) {
  const why = String(reason || "").trim().slice(0, 300);
  if (why.length < 3) throw badRequest("अस्वीकार करने का कारण लिखें (सदस्य को ऐप में दिखेगा)");
  const { rows: [r] } = await db.execute(sql`
    UPDATE payment_requests SET status = 'rejected', reject_reason = ${why}, reviewed_by_id = ${auth?.accountId || ""},
      reviewed_by_name = ${auth?.displayName || "Admin"}, reviewed_at = now(), updated_at = now()
    WHERE id = ${id} AND admin_id = ${adminId} AND status = 'pending'
    RETURNING request_no, requested_by_account_id, amount, items`);
  if (!r) throw conflict("अनुरोध अब बदल नहीं सकता (पहले से तय हो चुका है)");
  return { success: true, requestNo: r.request_no, accountId: r.requested_by_account_id, amount: r.amount, items: r.items };
}
