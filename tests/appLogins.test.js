// App logins: phones per login, renew keeps one phone, logout from the panel stops the session and push.  npm test
import "./setup.js";
process.env.JWT_SECRET ||= "test-secret-0123456789abcdef0123456789";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { issueToken } from "../src/lib/auth.js";
import { phoneTokens } from "../src/lib/push.js";
import { loginSummary, loginList, loginPhones, logoutPhones } from "../src/services/appLogins.js";

let admin, other, program, s1, s2;
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "l@test.in" }).returning();
  [other] = await db.insert(schema.admins).values({ email: "o@test.in" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah" }).returning();
  await db.insert(schema.agents).values({ id: "AG", adminId: admin.id, displayName: "Ramesh" });
  const m = (id, extra) => ({ id, programId: program.id, dateJoin: "2026-01-01", status: "accepted", displayName: id, ...extra });
  await db.insert(schema.members).values([m("p1", { registrationNumber: "R1", village: "Pali" }), m("p2", { registrationNumber: "R2" })]);
  await db.insert(schema.accounts).values([
    { id: "a1", role: "member", loginId: "r1", passwordHash: "x", adminId: admin.id, memberId: "p1" },
    { id: "a2", role: "member", loginId: "r2", passwordHash: "x", adminId: admin.id, memberId: "p2" },
    { id: "ag", role: "agent", loginId: "ag@x", passwordHash: "x", adminId: admin.id, agentId: "AG" },
    { id: "adm", role: "admin", loginId: "ad@x", passwordHash: "x", adminId: admin.id },
  ]);
  const acc = { id: "a1" };
  s1 = (await issueToken(acc, { device: "Samsung SM-A515F", platform: "android 14", appVersion: "2.0.0" })).sessionId;
  s2 = (await issueToken(acc, { device: "Redmi Note 12", platform: "android 13", appVersion: "2.0.0" })).sessionId;
  await issueToken({ id: "ag" }, { device: "Vivo Y20" });
  await issueToken({ id: "adm" }, { userAgent: "Chrome" });                 // panel login — not an app login
  await db.execute(sql`UPDATE sessions SET push_token = 'ExponentPushToken[one]' WHERE id = ${s1}`);
  await db.execute(sql`UPDATE sessions SET push_token = 'ExpoPushToken[two]' WHERE id = ${s2}`);
});
after(() => pool.end());

test("renewing the login keeps the same phone (no new session row)", async () => {
  const r = await issueToken({ id: "a1" }, { sessionId: s1, appVersion: "2.0.1" });
  assert.equal(r.sessionId, s1);
  const { rows: [{ n }] } = await db.execute(sql`SELECT count(*)::int AS n FROM sessions WHERE account_id = 'a1'`);
  assert.equal(n, 2);
  const [{ app_version }] = (await db.execute(sql`SELECT app_version FROM sessions WHERE id = ${s1}`)).rows;
  assert.equal(app_version, "2.0.1");
});

test("summary + list: members / agents, phones, push, logged in or not", async () => {
  const s = await loginSummary(admin.id);
  assert.deepEqual([s.members.logins, s.members.logged_in, s.members.phones, s.members.push], [2, 1, 2, 2]);
  assert.deepEqual([s.agents.logins, s.agents.logged_in, s.agents.phones], [1, 1, 1]);
  const inList = await loginList(admin.id, { role: "member", status: "in" });
  assert.deepEqual(inList.logins.map((x) => [x.name, x.phones]), [["p1", 2]]);
  const out = await loginList(admin.id, { role: "member", status: "out" });
  assert.deepEqual(out.logins.map((x) => x.registrationNumber), ["R2"]);
  assert.equal((await loginList(admin.id, { q: "pali" })).total, 1);
  assert.equal((await loginSummary(other.id)).members.logins, 0);   // another trust sees nothing
});

test("every phone gets push; logout one phone → its session and push end", async () => {
  assert.deepEqual([...(await phoneTokens(["a1"])).get("a1")].sort(), ["ExpoPushToken[two]", "ExponentPushToken[one]"]);
  const phones = await loginPhones(admin.id, "a1");
  assert.deepEqual(phones.map((p) => p.device).sort(), ["Redmi Note 12", "Samsung SM-A515F"]);
  const r = await logoutPhones(admin.id, "a1", { sessionId: s2 });
  assert.equal(r.loggedOut, 1);
  assert.deepEqual([...(await phoneTokens(["a1"])).get("a1")], ["ExponentPushToken[one]"]);
  assert.equal((await loginPhones(admin.id, "a1")).length, 1);
  await logoutPhones(admin.id, "a1");
  assert.equal((await loginPhones(admin.id, "a1")).length, 0);
  assert.equal((await phoneTokens(["a1"])).get("a1"), undefined);
  await assert.rejects(logoutPhones(other.id, "ag"), /nahi mila/);        // not this trust's login
  await assert.rejects(loginPhones(admin.id, "adm"), /nahi mila/);       // panel admins are not app logins
});
