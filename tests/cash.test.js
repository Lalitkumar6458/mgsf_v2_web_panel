// Agent cash hisaab: collected from the agent's own login vs. handed to the trust.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { cashSummary, agentLedger, addHandover, deleteHandover } from "../src/services/cashHandover.js";

let admin, program;
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "cash@test.in" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah" }).returning();
  await db.insert(schema.agents).values([{ id: "A1", adminId: admin.id, displayName: "Ramesh", phone: "9999999999" }, { id: "A2", adminId: admin.id, displayName: "Idle" }]);
  await db.insert(schema.accounts).values([
    { id: "accA1", role: "agent", loginId: "a1@x", passwordHash: "x", adminId: admin.id, agentId: "A1" },
    { id: "accAdmin", role: "admin", loginId: "ad@x", passwordHash: "x", adminId: admin.id },
  ]);
  await db.insert(schema.members).values({ id: "m1", programId: program.id, dateJoin: "2026-01-01", status: "accepted" });
  const t = (id, amount, by, method = "cash", day = "2026-10-10", status = "completed") =>
    ({ id, programId: program.id, transactionNumber: id, batchId: id, payerMemberId: "m1", amount, paymentMethod: method, paymentDate: day, createdById: by, status });
  await db.insert(schema.transactions).values([
    t("t1", 200, "accA1"), t("t2", 300, "accA1", "cash", "2026-10-12"),
    t("t3", 500, "accA1", "online"),            // online → not cash in hand
    t("t4", 900, "accAdmin"),                    // office entry → not the agent's
    t("t5", 700, "accA1", "cash", "2026-10-11", "reversed"),
  ]);
  await db.insert(schema.joinFeePayments).values({ programId: program.id, memberId: "m1", amount: 100, paymentMode: "cash", paymentDate: "2026-10-12", createdById: "accA1" });
});
after(() => pool.end());

test("collected only = agent's own cash entries; handover reduces the balance; ledger runs by day", async () => {
  let s = await cashSummary(admin.id, program.id, { today: "2026-10-12" });
  const a1 = s.agents.find((a) => a.agentId === "A1");
  assert.deepEqual([a1.collected, a1.joinFees, a1.handed, a1.balance, a1.todayCollected], [600, 100, 0, 600, 400]);
  assert.equal(s.agents.find((a) => a.agentId === "A2").balance, 0);

  const h = await addHandover(admin.id, program.id, { agentId: "A1", amount: 450, handedOn: "2026-10-12", mode: "bank" }, { accountId: "accAdmin", displayName: "Office" });
  s = await cashSummary(admin.id, program.id, { today: "2026-10-12" });
  assert.deepEqual([s.totals.balance, s.totals.todayHanded, s.totals.agentsHolding], [150, 450, 1]);

  const l = await agentLedger(admin.id, program.id, "A1");
  assert.deepEqual(l.days.map((d) => [d.day, d.collected, d.handed, d.balance]), [["2026-10-12", 400, 450, 150], ["2026-10-10", 200, 0, 200]]);
  assert.equal(l.handovers[0].receivedBy, "Office");

  await deleteHandover(admin.id, program.id, h.id);
  assert.equal((await cashSummary(admin.id, program.id)).totals.balance, 600);
  await assert.rejects(addHandover(admin.id, program.id, { agentId: "A1", amount: 0 }), /Rakam/);
  await assert.rejects(addHandover(admin.id, program.id, { agentId: "nope", amount: 10 }), /Agent/);
  await assert.rejects(agentLedger("other", program.id, "A1"), /Agent/);
});
