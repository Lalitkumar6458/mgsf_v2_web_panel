// Advance (अग्रिम): deposit, pay closings from advance (full / part + cash / bulk), reverse gives it back,
// refund, wrong-entry cancel, no double spend, closing revert, agent cash hisaab.   npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { createMember } from "../src/services/members.js";
import { recordClosing, revertClosing } from "../src/services/closings.js";
import { paySingle, payBulk, reverseTransaction, openDuesFor } from "../src/services/payments.js";
import { addAdvance, refundAdvance, reverseAdvance, advanceBalance, memberAdvances, programAdvances } from "../src/services/advances.js";
import { cashSummary } from "../src/services/cashHandover.js";
import { memberDues } from "../src/services/reports.js";

let admin, program, A, B, C1, C2, C3;
const auth = () => ({ role: "admin", adminId: admin.id, accountId: "office", displayName: "Office" });
const agentAuth = () => ({ role: "agent", adminId: admin.id, agentId: "AG", accountId: "agAcc", displayName: "Ramesh" });
const due = async (payer, closing) => (await db.execute(sql`SELECT paid_amount, status::text AS status FROM dues WHERE payer_member_id = ${payer} AND closing_member_id = ${closing}`)).rows[0];

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "adv@test.in", displayName: "Adv" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah", regMode: "series", regPrefix: "V" }).returning();
  await db.insert(schema.agents).values({ id: "AG", adminId: admin.id, displayName: "Ramesh" });
  await db.insert(schema.accounts).values({ id: "agAcc", role: "agent", loginId: "ag@x", passwordHash: "x", adminId: admin.id, agentId: "AG" });
  const add = async (name, extra = {}) => (await createMember(program, { displayName: name, dateJoin: "2026-01-01", payAmount: 200, ...extra }, auth())).member.id;
  A = await add("A", { agentId: "AG" });
  B = await add("B", { agentId: "AG" });
  C1 = await add("C1"); C2 = await add("C2"); C3 = await add("C3");
  await recordClosing(C1, { closingDate: "2026-03-01" });
  await recordClosing(C2, { closingDate: "2026-04-01" });
  await recordClosing(C3, { closingDate: "2026-05-01" });
});
after(() => pool.end());

test("deposit: whole rupees, reference for online, balance grows", async () => {
  await assert.rejects(addAdvance(A, { amount: 10.5 }, auth()), /poore rupaye/);
  await assert.rejects(addAdvance(A, { amount: 100, method: "upi" }, auth()), /reference/);
  await addAdvance(A, { amount: 300, method: "cash" }, agentAuth());
  await addAdvance(A, { amount: 100, method: "upi", reference: "UTR1" }, auth());
  await assert.rejects(addAdvance(B, { amount: 50, method: "upi", reference: "UTR1" }, auth()), /pehle se/);
  assert.equal(await advanceBalance(A), 400);
  assert.equal((await memberDues(A)).summary.advance, 400);
});

test("pay one closing fully from advance — no new cash", async () => {
  const r = await paySingle({ programId: program.id, payerId: A, closingIds: [C1], useAdvance: true }, auth());
  assert.deepEqual([r.totalPaid, r.fromAdvance], [200, 200]);
  assert.deepEqual(await due(A, C1), { paid_amount: 200, status: "paid" });
  assert.equal(await advanceBalance(A), 200);
  const { rows: [t] } = await db.execute(sql`SELECT payment_method FROM transactions WHERE payer_member_id = ${A} AND closing_member_id = ${C1}`);
  assert.equal(t.payment_method, "advance");
});

test("two closings, advance covers part, rest in cash (oldest first)", async () => {
  await addAdvance(A, { amount: 50 }, auth());           // balance 250
  const r = await paySingle({ programId: program.id, payerId: A, closingIds: [C2, C3], useAdvance: true, paymentMethod: "cash" }, auth());
  assert.deepEqual([r.totalPaid, r.fromAdvance, r.processed], [400, 250, 2]);
  assert.equal(await advanceBalance(A), 0);
  assert.deepEqual(await due(A, C2), { paid_amount: 200, status: "paid" });
  assert.deepEqual(await due(A, C3), { paid_amount: 200, status: "paid" });
  const { rows } = await db.execute(sql`
    SELECT c.display_name AS c, t.payment_method AS m, t.amount FROM transactions t JOIN members c ON c.id = t.closing_member_id
    WHERE t.batch_id = ${r.batchId} ORDER BY t.sequence_number`);
  assert.deepEqual(rows.map((x) => `${x.c}:${x.m}:${x.amount}`), ["C2:advance:200", "C3:advance:50", "C3:cash:150"]);
});

test("a fixed advance amount; more than the balance is refused", async () => {
  await addAdvance(B, { amount: 150 }, auth());
  await assert.rejects(paySingle({ programId: program.id, payerId: B, closingIds: [C1], useAdvance: 500 }, auth()), /sirf ₹150/);
  const r = await paySingle({ programId: program.id, payerId: B, closingIds: [C1], useAdvance: 100 }, auth());
  assert.deepEqual([r.totalPaid, r.fromAdvance], [200, 100]);
  assert.equal(await advanceBalance(B), 50);
});

test("reverse a payment made from advance → money back in advance; due open again", async () => {
  const { rows: [t] } = await db.execute(sql`SELECT id FROM transactions WHERE payer_member_id = ${A} AND closing_member_id = ${C1} AND status = 'completed'`);
  await reverseTransaction(t.id, { reason: "galti" }, auth());
  assert.equal(await advanceBalance(A), 200);
  assert.deepEqual(await due(A, C1), { paid_amount: 0, status: "pending" });
  const h = await memberAdvances(A);
  assert.equal(h.balance, 200);
  assert.equal(h.entries[0].kind, "return");
});

test("bulk custom with advance: each member's own advance pays his own closings", async () => {
  // A: 200 advance, owes C1 (200). B: 50 advance, owes C2 + C3 (400).
  const r = await payBulk({ programId: program.id, memberIds: [A, B], memberClosingSelections: { [A]: [C1], [B]: [C2, C3] }, useAdvance: true, paymentMethod: "cash" }, auth());
  assert.deepEqual([r.totalPaid, r.fromAdvance], [600, 250]);
  assert.equal(await advanceBalance(A), 0);
  assert.equal(await advanceBalance(B), 0);
});

test("never spent twice: two payments at the same moment share one advance", async () => {
  const D = (await createMember(program, { displayName: "D", dateJoin: "2026-01-01", payAmount: 200 }, auth())).member.id;
  // D owes C1, C2, C3 (600); advance 300
  await addAdvance(D, { amount: 300 }, auth());
  const r = await Promise.allSettled([
    paySingle({ programId: program.id, payerId: D, closingIds: [C1], useAdvance: true }, auth()),
    paySingle({ programId: program.id, payerId: D, closingIds: [C2], useAdvance: true }, auth()),
  ]);
  assert.ok(r.every((x) => x.status === "fulfilled"));
  const used = r.reduce((a, x) => a + x.value.fromAdvance, 0);
  assert.equal(used, 300);
  assert.equal(await advanceBalance(D), 0);
});

test("refund and cancelling a wrong deposit", async () => {
  const E = (await createMember(program, { displayName: "E", dateJoin: "2026-01-01" }, auth())).member.id;
  const dep = (await addAdvance(E, { amount: 500 }, auth())).entry;
  await assert.rejects(refundAdvance(E, { amount: 600 }, auth()), /sirf ₹500/);
  await refundAdvance(E, { amount: 100, note: "wapas" }, auth());
  assert.equal(await advanceBalance(E), 400);
  await assert.rejects(reverseAdvance(dep.id, {}, auth()), /lag chuka/);   // 100 of it went back already
  const dep2 = (await addAdvance(E, { amount: 100 }, auth())).entry;   // 500
  await reverseAdvance(dep2.id, { reason: "galat entry" }, auth());
  assert.equal(await advanceBalance(E), 400);
  await assert.rejects(reverseAdvance(dep2.id, {}, auth()), /pehle se cancel/);
  const pa = await programAdvances(program.id);
  assert.ok(pa.members.some((m) => m.id === E && m.balance === 400));
});

test("closing reverted → payments made from advance go back to the advance", async () => {
  const F = (await createMember(program, { displayName: "F", dateJoin: "2026-01-01", payAmount: 200 }, auth())).member.id;
  const X = (await createMember(program, { displayName: "X", dateJoin: "2026-01-01" }, auth())).member.id;
  await recordClosing(X, { closingDate: "2026-06-01" });
  await addAdvance(F, { amount: 200 }, auth());
  await paySingle({ programId: program.id, payerId: F, closingIds: [X], useAdvance: true }, auth());
  assert.equal(await advanceBalance(F), 0);
  await revertClosing(X, { force: true });
  assert.equal(await advanceBalance(F), 200);
});

test("agent cash hisaab counts advance cash he took, not payments from advance", async () => {
  const s = await cashSummary(admin.id, program.id);
  const ag = s.agents.find((x) => x.agentId === "AG");
  assert.equal(ag.collected, 300); // the ₹300 cash advance Ramesh took from A
});

test("book is right: advance transactions = uses − returns, no negative balance", async () => {
  const { rows } = await db.execute(sql`
    SELECT m.id,
      COALESCE((SELECT sum(amount) FROM transactions t WHERE t.payer_member_id = m.id AND t.payment_method = 'advance' AND t.status = 'completed'), 0)::int AS tx,
      COALESCE((SELECT sum(CASE kind WHEN 'use' THEN amount WHEN 'return' THEN -amount ELSE 0 END) FROM member_advances a WHERE a.member_id = m.id AND a.status = 'completed'), 0)::int AS used,
      COALESCE((SELECT sum(CASE WHEN kind IN ('deposit','return') THEN amount ELSE -amount END) FROM member_advances a WHERE a.member_id = m.id AND a.status = 'completed'), 0)::int AS bal
    FROM members m WHERE m.program_id = ${program.id}`);
  for (const r of rows) {
    assert.equal(r.tx, r.used, `member ${r.id}`);
    assert.ok(r.bal >= 0, `member ${r.id} balance ${r.bal}`);
  }
});

test("bulk screen data: open dues + advance in one call; result per member", async () => {
  const G = (await createMember(program, { displayName: "G", dateJoin: "2026-01-01", payAmount: 200 }, auth())).member.id;
  const H = (await createMember(program, { displayName: "H", dateJoin: "2026-01-01", payAmount: 300 }, auth())).member.id;
  await addAdvance(G, { amount: 250 }, auth());
  await paySingle({ programId: program.id, payerId: H, closingIds: [C1], customTotalAmount: 100 }, auth()); // partial
  const o = await openDuesFor(program.id, [G, H]);
  assert.equal(o.members[G].advance, 250);
  assert.equal(o.members[G].dues.length, 3);
  const h1 = o.members[H].dues.find((d) => d.closingMemberId === C1);
  assert.deepEqual([h1.amount, h1.paidAmount, h1.remaining], [300, 100, 200]);
  const r = await payBulk({ programId: program.id, memberIds: [G, H], memberClosingSelections: { [G]: o.members[G].dues.map((d) => d.id), [H]: [h1.id] }, useAdvance: true, paymentMethod: "cash" }, auth());
  const pm = Object.fromEntries(r.perMember.map((x) => [x.memberId, x]));
  assert.deepEqual([pm[G].paid, pm[G].fromAdvance, pm[G].closings], [600, 250, 3]);
  assert.deepEqual([pm[H].paid, pm[H].fromAdvance, pm[H].closings], [200, 0, 1]);
  assert.equal(r.totalPaid, 800);
});
