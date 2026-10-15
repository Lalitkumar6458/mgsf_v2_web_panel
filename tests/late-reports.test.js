// Due date (45 days), paid date, late / overdue report, agent ranking, member history.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { recordClosing, updateClosing } from "../src/services/closings.js";
import { paySingle } from "../src/services/payments.js";
import { latePayments, agentPerformance, memberPaymentHistory } from "../src/services/lateReports.js";
import { fmtISO, todayIST, addDays } from "../src/lib/dates.js";

let admin, program;
const auth = () => ({ role: "admin", adminId: admin.id, accountId: "a" });
const day = (n) => fmtISO(addDays(todayIST(), n));

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "l@test.in", displayName: "T" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah" }).returning();
  await db.insert(schema.agents).values([{ id: "G1", adminId: admin.id, displayName: "Good" }, { id: "B1", adminId: admin.id, displayName: "Bad" }]);
  const base = { programId: program.id, dateJoin: "2025-01-01", status: "accepted" };
  await db.insert(schema.members).values([
    { ...base, id: "g1", agentId: "G1", displayName: "g1" }, { ...base, id: "g2", agentId: "G1", displayName: "g2" },
    { ...base, id: "b1", agentId: "B1", displayName: "b1" }, { ...base, id: "b2", agentId: "B1", displayName: "b2" },
    { ...base, id: "C1", displayName: "C1", status: "closed", closingDate: day(-100) },
  ]);
  // C1's dues, due 55 days ago: g1 paid on time, g2 paid 10 days late, b1 paid 30 days late, b2 still unpaid (overdue 55)
  const due = day(-55);
  await db.insert(schema.dues).values([
    { id: "d1", programId: program.id, closingMemberId: "C1", payerMemberId: "g1", amount: 200, paidAmount: 200, status: "paid", dueDate: due, paidDate: day(-60) },
    { id: "d2", programId: program.id, closingMemberId: "C1", payerMemberId: "g2", amount: 200, paidAmount: 200, status: "paid", dueDate: due, paidDate: day(-45) },
    { id: "d3", programId: program.id, closingMemberId: "C1", payerMemberId: "b1", amount: 200, paidAmount: 200, status: "paid", dueDate: due, paidDate: day(-25) },
    { id: "d4", programId: program.id, closingMemberId: "C1", payerMemberId: "b2", amount: 200, paidAmount: 0, status: "pending", dueDate: due },
  ]);
});
after(() => pool.end());

test("buckets and days late", async () => {
  const r = await latePayments(program.id, { kind: "all" });
  const by = Object.fromEntries(r.rows.map((x) => [x.payerId, [x.kind, x.daysLate]]));
  assert.deepEqual(by, { g1: ["on_time", 0], g2: ["late", 10], b1: ["late", 30], b2: ["overdue", 55] });
  assert.deepEqual([r.summary.onTime, r.summary.late, r.summary.overdue, r.summary.notDue], [1, 2, 1, 0]);
  assert.equal(r.summary.avgLateDays, 20);
  assert.equal(Number(r.summary.overdueAmount), 200);
  const problems = await latePayments(program.id, { kind: "problem", agentId: "B1" });
  assert.equal(problems.total, 2);
  assert.equal(problems.rows[0].payerId, "b2"); // most days first
  assert.equal((await latePayments(program.id, { kind: "late", minDays: 20 })).total, 1);
});

test("agent ranking: on-time + collection", async () => {
  const { agents } = await agentPerformance(program.id);
  const good = agents.find((a) => a.agentId === "G1");
  const bad = agents.find((a) => a.agentId === "B1");
  assert.equal(good.rank, 1);
  assert.equal(good.onTimeRate, 50);
  assert.equal(good.collectionRate, 100);
  assert.equal(bad.onTimeRate, 0);
  assert.equal(bad.collectionRate, 50);
  assert.equal(bad.overdue, 1);
  assert.ok(good.score > bad.score);
});

test("member history", async () => {
  const h = await memberPaymentHistory("b1");
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].daysLate, 30);
  assert.equal(h.summary.late, 1);
  assert.equal(h.summary.avgLateDays, 30);
});

test("new closing: due = closing (or record day) + 45; payment stores paid date", async () => {
  await db.insert(schema.members).values({ id: "C2", programId: program.id, dateJoin: "2025-01-01", status: "accepted", displayName: "C2" });
  await recordClosing("C2", { closingDate: day(-3) }); // recorded today → 45 days from today
  const { rows: [d] } = await db.execute(sql`SELECT due_date FROM dues WHERE closing_member_id = 'C2' AND payer_member_id = 'g1'`);
  assert.equal(fmtISO(d.due_date), day(45));
  await paySingle({ programId: program.id, payerId: "g1", closingIds: ["C2"], paymentDate: day(-1) }, auth());
  const { rows: [p] } = await db.execute(sql`SELECT paid_date FROM dues WHERE closing_member_id = 'C2' AND payer_member_id = 'g1'`);
  assert.equal(fmtISO(p.paid_date), day(-1));
  // closing date moved later → unpaid dues follow
  await updateClosing("C2", { closingDate: day(10) });
  const { rows: [u] } = await db.execute(sql`SELECT due_date FROM dues WHERE closing_member_id = 'C2' AND payer_member_id = 'g2'`);
  assert.equal(fmtISO(u.due_date), day(55));
});
