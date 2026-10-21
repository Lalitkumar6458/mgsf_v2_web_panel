// Agent password: office can change it (was failing — empty update) and see the one it set.   npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { createAgent, updateAgent, listAgents, getAgent, forgetAgentPassword } from "../src/services/agents.js";
import { verifyPassword } from "../src/lib/auth.js";

let admin, ag;
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "ap@test.in", displayName: "AP" }).returning();
  ag = await createAgent(admin.id, { displayName: "Ramesh", email: "Ramesh@x.in", password: "first123", oldAgentId: "OLD7" });
});
after(() => pool.end());
const hash = async () => (await db.query.accounts.findFirst({ where: eq(schema.accounts.agentId, ag.id) })).passwordHash;

test("created password is shown to the office, never in the raw extra", async () => {
  const [a] = await listAgents(admin.id);
  assert.equal(a.password, "first123");
  assert.equal(a.extra.pwEnc, undefined);
  assert.equal(a.extra.oldAgentId, "OLD7");
  assert.equal((await getAgent(admin.id, ag.id, { viewer: "agent" })).password, undefined);
});

test("password-only change works, login uses it, details show it; a normal edit keeps it", async () => {
  await updateAgent(admin.id, ag.id, { password: "naya4567" });
  assert.ok(await verifyPassword("naya4567", await hash()));
  assert.equal((await getAgent(admin.id, ag.id)).password, "naya4567");
  await updateAgent(admin.id, ag.id, { displayName: "Ramesh Ji", oldAgentId: "OLD8" });
  const a = await getAgent(admin.id, ag.id);
  assert.equal(a.password, "naya4567");
  assert.equal(a.extra.oldAgentId, "OLD8");
  await assert.rejects(updateAgent(admin.id, ag.id, { password: "123" }), /6 akshar/);
});

test("agent changes it himself → office sees 'agent ne badla', not a stale password", async () => {
  await forgetAgentPassword(ag.id, "agent");
  const a = await getAgent(admin.id, ag.id);
  assert.equal(a.password, "");
  assert.equal(a.passwordBy, "agent");
});
