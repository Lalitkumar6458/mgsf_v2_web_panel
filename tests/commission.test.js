// Agent commission: rates, join fees, closing payments, reversals, payouts.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { calcCommission, normalizeCommission } from "../src/lib/commission.js";
import { addJoinFeePayments, deleteJoinFeePayment } from "../src/services/joinFees.js";
import { paySingle, reverseTransaction } from "../src/services/payments.js";
import { createMember } from "../src/services/members.js";
import { createAgent, updateAgent } from "../src/services/agents.js";
import {
  listCommissions, commissionSummary, createPayout, revertPayout, accruePast, agentsCommissionTotals,
} from "../src/services/commissions.js";

let admin, program;
const auth = () => ({ role: "admin", adminId: admin.id, accountId: "acc-admin", displayName: "Admin" });
const pct = { enabled: true, joinFees: { type: "percentage", value: 20 }, closing: { type: "percentage", value: 5 } };
const fixed = { enabled: true, joinFees: { type: "fixed", value: 100 }, closing: { type: "fixed", value: 10 } };
const onlyJoin = { enabled: true, joinFees: { type: "percentage", value: 20 }, closing: { enabled: false, value: 5 } };

const rows = async (agentId) => (await listCommissions(admin.id, agentId, { pageSize: 500 })).commissions;
const summary = (agentId) => commissionSummary(admin.id, agentId);

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "c@test.in", displayName: "T" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah" }).returning();
  await db.insert(schema.agents).values([
    { id: "AP", adminId: admin.id, displayName: "Percent", commission: normalizeCommission(pct) },
    { id: "AF", adminId: admin.id, displayName: "Fixed", commission: normalizeCommission(fixed) },
    { id: "AJ", adminId: admin.id, displayName: "Only join", commission: normalizeCommission(onlyJoin) },
    { id: "AO", adminId: admin.id, displayName: "Old agent (no config)" },
  ]);
  const base = { programId: program.id, dateJoin: "2026-01-01", status: "accepted", joinFees: 500 };
  await db.insert(schema.members).values([
    { ...base, id: "p1", agentId: "AP" }, { ...base, id: "f1", agentId: "AF" },
    { ...base, id: "j1", agentId: "AJ" }, { ...base, id: "o1", agentId: "AO" }, { ...base, id: "n1", agentId: null },
    { ...base, id: "C", agentId: null, closingDate: "2026-03-01" },
  ]);
  await db.insert(schema.dues).values(["p1", "f1", "j1", "o1", "n1"].map((p) => (
    { id: `d-${p}`, programId: program.id, closingMemberId: "C", payerMemberId: p, amount: 200 })));
});
after(() => pool.end());

test("calcCommission: percentage, fixed share, cap, off", () => {
  assert.equal(calcCommission(pct, "join_fees", 500, 500).amount, 100);
  assert.equal(calcCommission(pct, "closing", 200, 200).amount, 10);
  assert.equal(calcCommission(fixed, "join_fees", 250, 500).amount, 50);   // half paid → half of ₹100
  assert.equal(calcCommission(fixed, "closing", 200, 200).amount, 10);
  assert.equal(calcCommission({ enabled: true, closing: { type: "fixed", value: 900 } }, "closing", 200, 200).amount, 200); // never more than payment
  assert.equal(calcCommission(onlyJoin, "closing", 200, 200).applicable, false);
  assert.equal(calcCommission({}, "join_fees", 500, 500).applicable, false); // no config = off
  assert.equal(normalizeCommission({ enabled: true, joinFees: { value: 250 } }).joinFees.value, 100); // % capped at 100
});

test("join fee instalments earn commission for the member's agent", async () => {
  const r = await addJoinFeePayments(program.id, [
    { memberId: "p1", amount: 250 }, { memberId: "f1", amount: 250 }, { memberId: "j1", amount: 500 },
    { memberId: "o1", amount: 500 }, { memberId: "n1", amount: 500 },
  ], { paymentMode: "cash" }, auth());
  assert.equal(r.commissions, 3); // AO has no config, n1 has no agent
  assert.deepEqual((await rows("AP")).map((c) => [c.source, c.baseAmount, c.amount, c.rateValue]), [["join_fees", 250, 50, 20]]);
  assert.equal((await rows("AF"))[0].amount, 50);
  assert.equal((await rows("AJ"))[0].amount, 100);
  assert.equal((await rows("AO")).length, 0);
});

test("closing payments earn commission; part payments get their share; source switch respected", async () => {
  await paySingle({ programId: program.id, payerId: "p1", closingIds: ["C"] }, auth());
  await paySingle({ programId: program.id, payerId: "f1", closingIds: ["C"], customTotalAmount: 100 }, auth());
  await paySingle({ programId: program.id, payerId: "j1", closingIds: ["C"] }, auth());
  const ap = (await rows("AP")).find((c) => c.source === "closing");
  assert.equal(ap.amount, 10);
  assert.equal(ap.closingMemberId, "C");
  assert.equal((await rows("AF")).find((c) => c.source === "closing").amount, 5);
  assert.equal((await rows("AJ")).filter((c) => c.source === "closing").length, 0); // closing commission off for AJ
  const s = await summary("AP");
  assert.equal(s.earned, 60);
  assert.equal(s.pending, 60);
});

test("reversing an unpaid commission's payment cancels it", async () => {
  await paySingle({ programId: program.id, payerId: "f1", closingIds: ["C"] }, auth()); // remaining 100 → +5
  const { rows: [t] } = await db.execute(sql`SELECT id FROM transactions WHERE payer_member_id = 'f1' ORDER BY created_at DESC LIMIT 1`);
  await reverseTransaction(t.id, { reason: "wrong" }, auth());
  const c = (await rows("AF")).find((x) => x.sourceId === t.id);
  assert.equal(c.status, "cancelled");
  assert.equal((await summary("AF")).pending, 55); // 50 join + 5 first part
});

test("payout marks entries paid; reversal after payout creates a negative entry; payout revert", async () => {
  const p = await createPayout(admin.id, "AP", { mode: "all", paymentMode: "upi", reference: "UPI1" }, auth());
  assert.equal(p.payout.amount, 60);
  assert.equal(p.entries, 2);
  assert.match(p.payout.payoutNumber, /^COM-\d{8}-0001$/);
  assert.equal((await summary("AP")).paid, 60);
  assert.equal((await summary("AP")).pending, 0);

  // the closing payment is undone after the agent was paid
  const { rows: [t] } = await db.execute(sql`SELECT id FROM transactions WHERE payer_member_id = 'p1'`);
  await reverseTransaction(t.id, {}, auth());
  const neg = (await rows("AP")).find((c) => c.kind === "reversal");
  assert.equal(neg.amount, -10);
  assert.equal(neg.status, "pending");
  assert.equal((await summary("AP")).pending, -10);
  await assert.rejects(createPayout(admin.id, "AP", { mode: "all" }, auth()), /nothing to pay/);

  // more join fee → next payout nets the −10
  await addJoinFeePayments(program.id, [{ memberId: "p1", amount: 250 }], {}, auth());
  const p2 = await createPayout(admin.id, "AP", { mode: "all" }, auth());
  assert.equal(p2.payout.amount, 40);

  await revertPayout(admin.id, p2.payout.id, { reason: "test" });
  assert.equal((await summary("AP")).pending, 40);
});

test("pay up to an amount takes oldest entries first", async () => {
  await addJoinFeePayments(program.id, [{ memberId: "j1", amount: 100 }], { paymentDate: "2026-05-01" }, auth()); // +20, older
  const r = await createPayout(admin.id, "AJ", { mode: "upto", upto: 110 }, auth()); // 20 (May) fits, +100 (today) would not
  assert.equal(r.payout.amount, 20);
  assert.equal((await summary("AJ")).pending, 100);
});

test("deleting a join fee entry cancels its commission", async () => {
  const { rows: [jp] } = await db.execute(sql`SELECT id FROM join_fee_payments WHERE member_id = 'f1'`);
  await deleteJoinFeePayment(jp.id);
  assert.equal((await rows("AF")).find((c) => c.sourceId === jp.id).status, "cancelled");
});

test("turning commission on later + backfill old payments (idempotent)", async () => {
  await updateAgent(admin.id, "AO", { commission: pct });
  const r1 = await accruePast(admin.id, "AO", {});
  assert.equal(r1.joinFees, 1);
  assert.equal(r1.closing, 0);
  assert.equal((await accruePast(admin.id, "AO", {})).added, 0);
  assert.equal((await summary("AO")).pending, 100);
  const totals = await agentsCommissionTotals(admin.id, { programId: program.id });
  assert.equal(totals.find((t) => t.agentId === "AO").pending, 100);
});

test("join fee typed on the Add Member form earns commission on acceptance", async () => {
  const a = await createAgent(admin.id, { displayName: "New", email: "new@ag.in", password: "secret12", commission: pct });
  const r = await createMember(program, {
    displayName: "Form Member", dateJoin: "2026-02-01", agentId: a.id, joinFees: 500, joinFeesPaidAmount: 500, joinFeesDone: true,
  }, auth());
  assert.equal(r.joinFeeRecorded, 500);
  const list = await rows(a.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].amount, 100);
});
