// Login page / app welcome: which trust's name + logo, by domain (Feature control → Login page domain).   npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { publicBranding, setLoginDomains, requestHost } from "../src/services/trust.js";

let A, B;
before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [A] = await db.insert(schema.admins).values({ email: "a@x.in", displayName: "A", trustInfo: { name: "Pehla Trust", logo: "/api/files/logos/a.png" }, createdAt: new Date("2025-01-01") }).returning();
  [B] = await db.insert(schema.admins).values({ email: "b@x.in", displayName: "B", trustInfo: { name: "Manav Jyoti", logo: "/api/files/logos/b.png" } }).returning();
});
after(() => pool.end());

test("no domain set → oldest; domain set → that trust; default → used for unknown hosts", async () => {
  assert.equal((await publicBranding("admin.manavjyoti.tech")).name, "Pehla Trust");
  await setLoginDomains(B.id, { domains: "https://Admin.ManavJyoti.tech/, srv1.hstgr.cloud" });
  assert.equal((await publicBranding("admin.manavjyoti.tech")).logo, "/api/files/logos/b.png");
  assert.equal((await publicBranding("srv1.hstgr.cloud")).name, "Manav Jyoti");
  assert.equal((await publicBranding("other.in")).name, "Pehla Trust");
  await setLoginDomains(B.id, { domains: ["admin.manavjyoti.tech"], isDefault: true });
  assert.equal((await publicBranding("other.in")).name, "Manav Jyoti");
  await assert.rejects(setLoginDomains(A.id, { domains: "admin.manavjyoti.tech" }), /pehle se/);
  await assert.rejects(setLoginDomains(A.id, { domains: "not a domain" }), /galat/);
  assert.equal(requestHost(new Request("http://x/", { headers: { host: "Admin.ManavJyoti.tech:443" } })), "admin.manavjyoti.tech");
});
