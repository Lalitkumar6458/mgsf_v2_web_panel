// Closing dues stay correct when join dates, closing dates or groups are edited.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { createMember, updateMember } from "../src/services/members.js";
import { recordClosing, updateClosing, revertClosing, payerDuesCheck } from "../src/services/closings.js";
import { paySingle } from "../src/services/payments.js";

let admin, program;
const auth = () => ({ role: "admin", adminId: admin.id, accountId: "a" });
const M = {};
const owes = async (payer) => (await db.execute(sql`
  SELECT c.display_name FROM dues d JOIN members c ON c.id = d.closing_member_id
  WHERE d.payer_member_id = ${payer} ORDER BY c.closing_date`)).rows.map((r) => r.display_name);
const member = async (id) => {
  const m = await db.query.members.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  m.program = program;
  return m;
};
const add = async (name, dateJoin) => (await createMember(program, { displayName: name, dateJoin }, auth())).member.id;

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "s@test.in", displayName: "T" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah", regMode: "series", regPrefix: "S" }).returning();
  await db.insert(schema.closingGroups).values([{ id: "G1", programId: program.id, name: "G1" }, { id: "G2", programId: program.id, name: "G2" }]);
  M.X = await add("X", "2025-12-01");
  M.Y = await add("Y", "2025-12-01");
  M.A = await add("A", "2026-01-01");
  M.B = await add("B", "2026-01-01");
  M.C = await add("C", "2026-03-01");
  await recordClosing(M.X, { closingDate: "2026-02-15", closingGroupId: "G1" });
  await recordClosing(M.Y, { closingDate: "2026-04-10", closingGroupId: "G1" });
});
after(() => pool.end());

test("closing dues follow join dates", async () => {
  assert.deepEqual(await owes(M.A), ["X", "Y"]);
  assert.deepEqual(await owes(M.C), ["Y"]);     // joined after X's closing
  assert.deepEqual(await owes(M.X), []);         // X closed before Y → owes nothing
  assert.deepEqual(await owes(M.Y), ["X"]);
});

test("join date moved earlier → missing closing added; later → untouched dues removed", async () => {
  let r = await updateMember(await member(M.C), { dateJoin: "2026-02-01" });
  assert.equal(r.duesAdded, 1);
  assert.deepEqual(await owes(M.C), ["X", "Y"]);
  r = await updateMember(await member(M.C), { dateJoin: "2026-05-01" });
  assert.equal(r.duesRemoved, 2);
  assert.deepEqual(await owes(M.C), []);
  await updateMember(await member(M.C), { dateJoin: "2026-03-01" });
  assert.deepEqual(await owes(M.C), ["Y"]);
});

test("join date change refused when money for a no-longer-owed closing is already in", async () => {
  await paySingle({ programId: program.id, payerId: M.A, closingIds: [M.X] }, auth());
  await assert.rejects(updateMember(await member(M.A), { dateJoin: "2026-03-01" }), /paisa pehle se jama/);
  assert.equal((await member(M.A)).dateJoin, "2026-01-01"); // nothing changed
  assert.deepEqual(await owes(M.A), ["X", "Y"]);
});

test("closing date edit: payers re-synced, paid payers protected, closing member's own dues follow", async () => {
  // move X's closing to March 5 → C (joined Mar 1) now owes X
  let r = await updateClosing(M.X, { closingDate: "2026-03-05" });
  assert.equal(r.duesAdded, 1);
  assert.deepEqual(await owes(M.C), ["X", "Y"]);
  // before A joined → A already paid → refused
  await assert.rejects(updateClosing(M.X, { closingDate: "2025-12-20" }), /paisa jama hai/);
  // X's closing after Y's → X now owes Y as a payer
  r = await updateClosing(M.X, { closingDate: "2026-05-01" });
  assert.equal(r.ownDuesAdded, 1);
  assert.deepEqual(await owes(M.X), ["Y"]);
  assert.deepEqual(await owes(M.Y), []);          // Y closed (Apr 10) before X's new date → Y's untouched due removed
  r = await updateClosing(M.X, { closingDate: "2026-02-15" });
  assert.equal(r.ownDuesRemoved, 1);
  assert.deepEqual(await owes(M.X), []);
  assert.deepEqual(await owes(M.Y), ["X"]);
  assert.deepEqual(await owes(M.C), ["Y"]);
});

test("changing only the closing group leaves dues alone", async () => {
  const before = await owes(M.A);
  await updateClosing(M.X, { closingGroupId: "G2" });
  assert.equal((await member(M.X)).closingGroupId, "G2");
  assert.deepEqual(await owes(M.A), before);
});

test("new member with an old join date owes every closing since then", async () => {
  M.D = await add("D", "2026-02-01");
  assert.deepEqual(await owes(M.D), ["X", "Y"]);
});

test("revert closing: member owes again by the same rule", async () => {
  await revertClosing(M.Y);
  assert.deepEqual(await owes(M.Y), ["X"]);
  await recordClosing(M.Y, { closingDate: "2026-04-10" });
});

test("everyone's dues match the rule (no missing, no extra)", async () => {
  for (const id of Object.values(M)) {
    const c = await payerDuesCheck(id);
    assert.equal(c.missing.length, 0, `missing for ${id}`);
    assert.equal(c.extra.length, 0, `extra for ${id}`);
  }
});

test("pay amount 0 → no pending entries; back to 200 → entries again", async () => {
  M.Z = await add("Z", "2026-01-01");
  assert.deepEqual(await owes(M.Z), ["X", "Y"]);
  let r = await updateMember(await member(M.Z), { payAmount: 0 });
  assert.equal(r.duesRemoved, 2);
  assert.deepEqual(await owes(M.Z), []);
  // a new closing does not bill him either
  M.W = await add("W", "2025-12-01");
  await recordClosing(M.W, { closingDate: "2026-06-01" });
  assert.deepEqual(await owes(M.Z), []);
  assert.equal((await payerDuesCheck(M.Z)).missing.length, 0);
  r = await updateMember(await member(M.Z), { payAmount: 200 });
  assert.equal(r.duesAdded, 3);
  // new member added with pay amount 0 gets nothing
  const zero = (await createMember(program, { displayName: "Zero", dateJoin: "2026-01-01", payAmount: 0 }, auth())).member.id;
  assert.deepEqual(await owes(zero), []);
});

test("members closed on the same day owe each other", async () => {
  const ids = [];
  for (const n of ["S1", "S2", "S3"]) ids.push(await add(n, "2026-01-01"));
  for (const id of ids) await recordClosing(id, { closingDate: "2026-07-01" });
  for (const id of ids) {
    const mine = await owes(id);
    const others = ["S1", "S2", "S3"].filter((n) => n !== ids.indexOf(id) && n !== `S${ids.indexOf(id) + 1}`);
    for (const o of others) assert.ok(mine.includes(o), `${id} should owe ${o}`);
    assert.ok(!mine.includes(`S${ids.indexOf(id) + 1}`)); // never himself
    const c = await payerDuesCheck(id);
    assert.equal(c.missing.length + c.extra.length, 0);
  }
  // somebody closed the day before does not owe the later ones
  const early = await add("E", "2026-01-01");
  await recordClosing(early, { closingDate: "2026-06-30" });
  assert.ok(!(await owes(early)).includes("S1"));
});
