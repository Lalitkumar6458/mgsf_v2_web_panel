// Business-logic tests against a real Postgres (TEST_DATABASE_URL — it gets wiped!).  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { createMember, acceptMember, nextApplicationNumber, listMembers, setMemberStatus } from "../src/services/members.js";
import { recordClosing, updateClosing, revertClosing, payerDuesCheck, applyPayerCorrection, listClosings } from "../src/services/closings.js";
import { paySingle, payBulk, reverseTransaction, listTransactions } from "../src/services/payments.js";
import { agentReport, memberDues, programDashboard } from "../src/services/reports.js";
import { verifyPassword } from "../src/lib/auth.js";
import { addJoinFeePayments, deleteJoinFeePayment, listJoinFeePayments } from "../src/services/joinFees.js";

let admin, program, agent;
const adminAuth = () => ({ role: "admin", adminId: admin.id, accountId: "acc-admin" });
const agentAuth = () => ({ role: "agent", adminId: admin.id, agentId: agent.id, accountId: "acc-agent" });
const M = {};

async function due(closingId, payerId) {
  const { rows } = await db.execute(sql`SELECT * FROM dues WHERE closing_member_id = ${closingId} AND payer_member_id = ${payerId}`);
  return rows[0];
}

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "trust@test.in", displayName: "Test Trust" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah Yojna", regMode: "series", regPrefix: "MG", regDigits: 4 }).returning();
  [agent] = await db.insert(schema.agents).values({ adminId: admin.id, displayName: "Ramesh Agent" }).returning();
});
after(() => pool.end());

test("admin creates members → accepted, series reg numbers, login account", async () => {
  const a = await createMember(program, { displayName: "Amit Kumar", dateJoin: "01-01-2026", bobDate: "05-06-1998", aadhaarNo: "111122223333", agentId: agent.id }, adminAuth());
  const b = await createMember(program, { displayName: "Bharat", dateJoin: "2026-02-01", birthDate: "2000-01-01", agentId: agent.id }, adminAuth());
  const c = await createMember(program, { displayName: "Chetan", dateJoin: "01-03-2026", payAmount: 300, agentId: agent.id }, adminAuth());
  M.A = a.member.id; M.B = b.member.id; M.C = c.member.id;
  assert.equal(a.registrationNumber, "MG0001");
  assert.equal(b.registrationNumber, "MG0002");
  assert.equal(c.member.memberNumber, 3);
  assert.equal(a.initialPassword, "amit1998"); // old rule: first word (max 5 letters) + birth year
  const acc = await db.query.accounts.findFirst({ where: (t, { eq }) => eq(t.memberId, M.A) });
  assert.equal(acc.loginId, "mg0001");
  assert.ok(await verifyPassword("amit1998", acc.passwordHash));
});

test("duplicate aadhaar is refused", async () => {
  await assert.rejects(createMember(program, { displayName: "X", aadhaarNo: "111122223333" }, adminAuth()), /आधार/);
});

test("agent-added member is a pending request until accepted", async () => {
  const d = await createMember(program, { displayName: "Dinesh", dateJoin: "01-01-2026" }, agentAuth());
  M.D = d.member.id;
  assert.equal(d.member.status, "pending");
  assert.equal(d.member.agentId, agent.id);
  assert.equal(d.member.registrationNumber, "");
});

test("closing creates dues only for eligible payers (no self-payment, join date rule)", async () => {
  const r = await recordClosing(M.A, { closingDate: "15-02-2026" });
  assert.equal(r.duesCreated, 1); // only B (C joined after, D pending, A himself excluded)
  assert.ok(await due(M.A, M.B));
  assert.equal(await due(M.A, M.A), undefined);
  assert.equal(await due(M.A, M.C), undefined);
  await assert.rejects(recordClosing(M.A, { closingDate: "16-02-2026" }), /already closed/);
});

test("accepting a member: owes every closing on/after his join date", async () => {
  const r = await acceptMember(M.D);
  assert.equal(r.registrationNumber, "MG0004");
  assert.equal(r.duesCreated, 1); // joined 01-01-2026 → owes A's closing (15-02-2026)
});

test("second closing: closed members and later joiners are skipped, pay amount comes from payer", async () => {
  const r = await recordClosing(M.B, { closingDate: "2026-05-01" });
  assert.equal(r.duesCreated, 2); // C and D; A is already closed (Feb)
  assert.equal((await due(M.B, M.C)).amount, 300);
  assert.equal((await due(M.B, M.D)).amount, 200);
  assert.equal(await due(M.B, M.A), undefined);
});

test("Correct Payments check finds D's missing due for A and applies it", async () => {
  await db.execute(sql`DELETE FROM dues WHERE closing_member_id = ${M.A} AND payer_member_id = ${M.D}`);
  const chk = await payerDuesCheck(M.D);
  assert.deepEqual(chk.missing.map((x) => x.closingMemberId), [M.A]);
  assert.equal(chk.extra.length, 0);
  const r = await applyPayerCorrection(M.D, { addClosingIds: [M.A] });
  assert.equal(r.added, 1);
  assert.equal((await due(M.A, M.D)).added_manually, true);
});

test("single payment: full, then refuses paying the same closing again", async () => {
  const r = await paySingle({ programId: program.id, payerId: M.C, closingIds: [M.B], paymentMethod: "cash", paymentDate: "10-05-2026" }, adminAuth());
  assert.equal(r.totalPaid, 300);
  assert.equal((await due(M.B, M.C)).status, "paid");
  await assert.rejects(paySingle({ programId: program.id, payerId: M.C, closingIds: [M.B] }, adminAuth()), /already paid/);
});

test("partial payment then rest; overpay refused; duplicate online reference refused", async () => {
  await assert.rejects(paySingle({ programId: program.id, payerId: M.D, closingIds: [M.B], customTotalAmount: 500 }, adminAuth()), /more than outstanding/);
  await paySingle({ programId: program.id, payerId: M.D, closingIds: [M.B], customTotalAmount: 120, paymentMethod: "online", onlineReference: "UPI123" }, adminAuth());
  let d = await due(M.B, M.D);
  assert.equal(d.status, "partial");
  assert.equal(d.paid_amount, 120);
  await assert.rejects(paySingle({ programId: program.id, payerId: M.D, closingIds: [M.B], paymentMethod: "online", onlineReference: "UPI123" }, adminAuth()), /Duplicate reference/);
  await paySingle({ programId: program.id, payerId: M.D, closingIds: [M.B] }, adminAuth());
  d = await due(M.B, M.D);
  assert.equal(d.status, "paid");
  assert.equal(d.paid_amount, 200);
});

test("bulk waterfall pays whole closings only", async () => {
  const r = await payBulk({ programId: program.id, memberIds: [M.B, M.D], globalAmount: 250 }, agentAuth());
  // open dues: B→A 200, D→A 200 ; 250 covers one
  assert.equal(r.closingsProcessed, 1);
  assert.equal(r.totalPaid, 200);
  assert.equal(r.remaining, 50);
});

test("bulk custom selection pays exactly the chosen dues", async () => {
  const open = (await memberDues(M.D, { status: "pending" })).dues;
  const openB = (await memberDues(M.B, { status: "pending" })).dues;
  const pending = [...open, ...openB];
  assert.equal(pending.length, 1);
  const owner = open.length ? M.D : M.B;
  const r = await payBulk({ programId: program.id, memberIds: [M.B, M.D], memberClosingSelections: { [owner]: [pending[0].id] } }, agentAuth());
  assert.equal(r.closingsProcessed, 1);
  assert.equal(r.mode, "custom_selection");
});

test("reports: agent report, closings list, dashboard, transactions", async () => {
  const rep = await agentReport(program.id, agent.id);
  assert.equal(rep.summary.totalMembers, 4); // A,B,C (+D added by agent)
  assert.equal(rep.summary.totalPending, 0);
  assert.equal(rep.summary.totalPaidAmount, 200 + 300 + 200 + 200);
  assert.ok(rep.closings[M.A].closingMemberName === "Amit Kumar");
  assert.equal(rep.closings[M.A].marriageDate, "15-02-2026");

  const cl = await listClosings(program.id);
  assert.equal(cl.closings.length, 2);
  const b = cl.closings.find((x) => x.id === M.B);
  assert.equal(b.paid, 2);
  assert.equal(b.completionPct, 100);

  const dash = await programDashboard(program.id);
  assert.equal(dash.members.closed, 2);
  assert.equal(dash.payments.outstanding, 0);

  const tx = await listTransactions(program.id, { q: "chetan" });
  assert.equal(tx.total, 1);
  assert.equal(tx.transactions[0].payerName, "Chetan");
});

test("reverse a transaction gives the amount back to the due", async () => {
  const tx = await listTransactions(program.id, { payerId: M.C });
  await reverseTransaction(tx.transactions[0].id, { reason: "wrong entry" }, adminAuth());
  assert.equal((await due(M.B, M.C)).status, "pending");
  await assert.rejects(reverseTransaction(tx.transactions[0].id, {}, adminAuth()), /already reversed/);
});

test("edit closing date re-syncs dues of that closing", async () => {
  // move B's closing before C joined → C no longer owes it (his due is pending again after the reversal)
  const r = await updateClosing(M.B, { closingDate: "20-02-2026" });
  assert.equal(r.duesRemoved, 1);
  assert.equal(await due(M.B, M.C), undefined);
  await updateClosing(M.B, { closingDate: "01-05-2026" });
  assert.ok(await due(M.B, M.C));
});

test("revert closing refuses when money is received, force keeps audit trail, member owes again", async () => {
  await assert.rejects(revertClosing(M.B), /already received/);
  const r = await revertClosing(M.B, { force: true });
  assert.equal(r.deletedDues, 2);
  assert.ok(r.reversedTransactions >= 1);
  const { rows: [b] } = await db.execute(sql`SELECT status, closing_date FROM members WHERE id = ${M.B}`);
  assert.equal(b.status, "accepted");
  assert.equal(b.closing_date, null);
  // B's own paid due for A's closing is NOT deleted (old function deleted it)
  assert.equal((await due(M.A, M.B)).status, "paid");
  const { rows: rev } = await db.execute(sql`SELECT count(*)::int n FROM transactions WHERE closing_member_id = ${M.B} AND status = 'reversed'`);
  assert.ok(rev[0].n >= 2);
});

test("next application number + search", async () => {
  assert.equal(await nextApplicationNumber(program.id), "5501");
  await db.execute(sql`UPDATE members SET application_number = '5600A' WHERE id = ${M.C}`);
  assert.equal(await nextApplicationNumber(program.id), "5601");
  const s = await listMembers(program.id, { q: "bhar" });
  assert.equal(s.total, 1);
  assert.equal(s.members[0].displayName, "Bharat");
});

test("removed member stops owing pending dues", async () => {
  await recordClosing(M.B, { closingDate: "2026-06-01" });
  assert.ok(await due(M.B, M.D));
  const r = await setMemberStatus(M.D, "removed");
  assert.ok(r.pendingDuesRemoved >= 1);
  assert.equal(await due(M.B, M.D), undefined);
});

test("join fee instalments keep member totals in sync", async () => {
  await db.execute(sql`UPDATE members SET join_fees = 1100 WHERE id = ${M.C}`);
  await addJoinFeePayments(program.id, [{ memberId: M.C, amount: 600 }], { paymentMode: "cash", paymentDate: "01-03-2026" }, adminAuth());
  let { rows: [c] } = await db.execute(sql`SELECT join_fees_paid_amount, join_fees_remaining_amount, join_fees_done FROM members WHERE id = ${M.C}`);
  assert.deepEqual([c.join_fees_paid_amount, c.join_fees_remaining_amount, c.join_fees_done], [600, 500, false]);
  await addJoinFeePayments(program.id, [{ memberId: M.C, amount: 500 }], { paymentMode: "upi", transactionId: "UTR1" }, adminAuth());
  ({ rows: [c] } = await db.execute(sql`SELECT join_fees_paid_amount, join_fees_done, join_fees_txn_id FROM members WHERE id = ${M.C}`));
  assert.deepEqual([c.join_fees_paid_amount, c.join_fees_done, c.join_fees_txn_id], [1100, true, "UTR1"]);
  const list = await listJoinFeePayments(M.C);
  assert.equal(list.length, 2);
  await deleteJoinFeePayment(list.find((x) => x.amount === 600).id);
  ({ rows: [c] } = await db.execute(sql`SELECT join_fees_paid_amount, join_fees_done FROM members WHERE id = ${M.C}`));
  assert.deepEqual([c.join_fees_paid_amount, c.join_fees_done], [500, false]);
});

test("accepting a request saves the accept-dialog fields and activates the member", async () => {
  const r = await createMember(program, { displayName: "Farida Bano", dateJoin: "01-01-2026", birthDate: "01-01-1995" }, agentAuth());
  await db.execute(sql`UPDATE members SET active = false WHERE id = ${r.member.id}`); // old requests were inactive
  const a = await acceptMember(r.member.id, { joinFeesDone: true, joinFeesPaidAmount: 1100, closingMonths: 3 });
  assert.equal(a.initialPassword, "farid1995");
  const { rows: [m] } = await db.execute(sql`SELECT status, active, join_fees_done, join_fees_paid_amount, closing_months FROM members WHERE id = ${r.member.id}`);
  assert.deepEqual([m.status, m.active, m.join_fees_done, m.join_fees_paid_amount, m.closing_months], ["accepted", true, true, 1100, 3]);
});
