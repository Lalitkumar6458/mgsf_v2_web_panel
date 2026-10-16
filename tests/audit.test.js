// Audit log: what gets written, secrets stripped, list filters.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { describeRequest, cleanDetails, summarize, writeAudit, auditRequest, listAudit } from "../src/services/audit.js";

let trust;
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [trust] = await db.insert(schema.admins).values({ email: "a@test.in", displayName: "Audit Trust" }).returning();
});
after(() => pool.end());

test("describe: paths → action / entity; reads and auth calls skipped", () => {
  assert.deepEqual(describeRequest("POST", "/api/transactions/t1/reverse"), { action: "reverse", entity: "payment", entityId: "t1" });
  assert.equal(describeRequest("PATCH", "/api/members/m1").entity, "member");
  assert.equal(describeRequest("DELETE", "/api/members/m1").action, "delete");
  assert.equal(describeRequest("POST", "/api/programs/p1/members").programId, "p1");
  assert.equal(describeRequest("POST", "/api/programs/p1/payments").entity, "payment");
  assert.equal(describeRequest("PATCH", "/api/trust/theme").entity, "theme");
  assert.equal(describeRequest("GET", "/api/members/m1"), null);
  assert.equal(describeRequest("POST", "/api/auth/login"), null);
  assert.equal(describeRequest("POST", "/api/upload"), null);
});

test("details: passwords / OTP / images never stored", () => {
  const c = cleanDetails({ displayName: "Ram", password: "secret123", otp: "1234", photo: "data:image/png;base64,AAAA", nested: { apiKey: "x" } });
  assert.equal(c.password, "•••");
  assert.equal(c.otp, "•••");
  assert.equal(c.photo, "[file]");
  assert.equal(c.nested.apiKey, "•••");
  assert.equal(c.displayName, "Ram");
  assert.match(summarize({ action: "create", entity: "member" }, { displayName: "Ram Lal" }), /Member banaya — Ram Lal/);
  assert.match(summarize({ action: "create", entity: "payment" }, { amount: 1500 }), /₹1,500/);
});

test("write + list with filters", async () => {
  const auth = { adminId: trust.id, accountId: "acc1", displayName: "Office Staff", role: "admin", access: { roleName: "Manager" } };
  await writeAudit({ adminId: trust.id, auth, action: "create", entity: "member", entityId: "m1", summary: "Member banaya — Ram" });
  auditRequest({ auth, request: new Request("http://x/api/transactions/t9/reverse", { method: "POST" }), body: { reason: "galat" }, result: {}, ip: "1.2.3.4" });
  await new Promise((r) => setTimeout(r, 100)); // fire-and-forget
  let out = await listAudit(trust.id, {});
  assert.equal(out.total, 2);
  assert.equal(out.logs[0].actorRole, "Manager");
  out = await listAudit(trust.id, { entity: "payment" });
  assert.equal(out.total, 1);
  assert.equal(out.logs[0].entityId, "t9");
  assert.equal(out.logs[0].ip, "1.2.3.4");
  out = await listAudit(trust.id, { q: "Ram" });
  assert.equal(out.total, 1);
  assert.equal(out.actors[0].name, "Office Staff");
  assert.equal((await listAudit("other", {})).total, 0);
});
