// Duplicate member check across all yojna of a trust.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { findDuplicates } from "../src/services/duplicates.js";

let a1, a2;
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [a1] = await db.insert(schema.admins).values({ email: "d1@test.in" }).returning();
  [a2] = await db.insert(schema.admins).values({ email: "d2@test.in" }).returning();
  const [p1] = await db.insert(schema.programs).values({ adminId: a1.id, name: "Vivah" }).returning();
  const [p2] = await db.insert(schema.programs).values({ adminId: a1.id, name: "Suraksha" }).returning();
  const [p3] = await db.insert(schema.programs).values({ adminId: a2.id, name: "Other trust" }).returning();
  const b = { dateJoin: "2026-01-01", status: "accepted" };
  await db.insert(schema.members).values([
    { ...b, id: "x1", programId: p1.id, displayName: "Ramesh Kumar", fatherName: "Mohan Lal", phone: "+91 98765 43210", aadhaarNo: "123412341234" },
    { ...b, id: "x2", programId: p2.id, displayName: "Sita", fatherName: "Ram", phoneAlt: "9876543210" },
    { ...b, id: "x3", programId: p2.id, displayName: "Gone", aadhaarNo: "999999999999", deleted: true },
    { ...b, id: "x4", programId: p3.id, displayName: "Ramesh Kumar", fatherName: "Mohan Lal", aadhaarNo: "123412341234" },
  ]);
});
after(() => pool.end());

test("matches by Aadhaar, mobile (also alt / formatted) and name + father — only this trust", async () => {
  let m = await findDuplicates(a1.id, { aadhaarNo: "1234 1234 1234" });
  assert.deepEqual(m.map((x) => [x.id, x.reasons]), [["x1", ["aadhaar"]]]);
  m = await findDuplicates(a1.id, { phone: "9876543210" });
  assert.deepEqual(m.map((x) => x.id).sort(), ["x1", "x2"]);
  m = await findDuplicates(a1.id, { name: " ramesh  kumar", fatherName: "MOHAN LAL" });
  assert.deepEqual(m.map((x) => [x.id, x.programName]), [["x1", "Vivah"]]);
  assert.deepEqual(await findDuplicates(a1.id, { aadhaarNo: "999999999999" }), []); // deleted ignored
  assert.deepEqual(await findDuplicates(a1.id, { phone: "123" }), []);               // too short → no search
  assert.deepEqual((await findDuplicates(a1.id, { phone: "9876543210", excludeId: "x1" })).map((x) => x.id), ["x2"]);
});
