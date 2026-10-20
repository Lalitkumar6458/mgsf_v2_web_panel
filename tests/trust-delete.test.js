// Feature control → delete a trust completely (rows + uploaded files).   npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { createMember } from "../src/services/members.js";
import { recordClosing } from "../src/services/closings.js";
import { trustDeleteInfo, trustBackup, deleteTrust, trustFileKeys } from "../src/services/trustDelete.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mgsf-up-"));
let A, B, pA;
const office = (a) => ({ role: "admin", adminId: a.id, accountId: "o", displayName: "Office" });
const put = (key) => { const f = path.join(dir, key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, "x"); return `/api/files/${key}`; };

before(async () => {
  process.env.STORAGE = "local"; process.env.UPLOAD_DIR = dir;
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps, migration_jobs RESTART IDENTITY CASCADE`);
  [A] = await db.insert(schema.admins).values({ email: "del@a.in", displayName: "A", trustInfo: { name: "Trust A", logoUrl: put("logos/a.png") } }).returning();
  [B] = await db.insert(schema.admins).values({ email: "keep@b.in", displayName: "B" }).returning();
  [pA] = await db.insert(schema.programs).values({ adminId: A.id, name: "Vivah", regMode: "series", regPrefix: "A" }).returning();
  const [pB] = await db.insert(schema.programs).values({ adminId: B.id, name: "Vivah", regMode: "series", regPrefix: "B" }).returning();
  await db.insert(schema.agents).values({ id: "AGA", adminId: A.id, displayName: "Ag", photoUrl: put("agents/1.jpg") });
  const m1 = (await createMember(pA, { displayName: "M1", dateJoin: "2026-01-01", payAmount: 200, photoUrl: put("members/1.jpg"), documentFrontUrl: put("members/1-doc.pdf") }, office(A))).member.id;
  const m2 = (await createMember(pA, { displayName: "M2", dateJoin: "2026-01-01", payAmount: 200 }, office(A))).member.id;
  await recordClosing(m2, { closingDate: "2026-03-01" });
  void m1;
  await createMember(pB, { displayName: "Other", dateJoin: "2026-01-01", payAmount: 200, photoUrl: put("members/b.jpg") }, office(B));
  await db.insert(schema.accounts).values({ role: "owner", loginId: "owner-x", displayName: "Owner", passwordHash: "x", adminId: A.id });
});
after(() => { pool.end(); fs.rmSync(dir, { recursive: true, force: true }); });

test("info + backup: counts, files of this trust only, no password hashes", async () => {
  const info = await trustDeleteInfo(A.id);
  assert.equal(info.counts.members, 2);
  assert.equal(info.counts.programs, 1);
  assert.ok(info.counts.dues >= 1);
  const keys = (await trustFileKeys(A.id)).sort();
  assert.deepEqual(keys, ["agents/1.jpg", "logos/a.png", "members/1-doc.pdf", "members/1.jpg"]);
  const { json } = await trustBackup(A.id);
  const b = JSON.parse(json);
  assert.equal(b.tables.members.length, 2);
  assert.ok(b.tables.accounts.every((a) => a.password_hash === undefined));
});

test("delete: wrong e-mail refused; then every row + file gone, other trust and owner login kept", async () => {
  await assert.rejects(deleteTrust(A.id, { confirm: "keep@b.in" }), /e-mail likhein/);
  const r = await deleteTrust(A.id, { confirm: "DEL@a.in" });
  assert.equal(r.files.removed, 4);
  assert.equal(r.files.failed, 0);
  for (const f of ["logos/a.png", "agents/1.jpg", "members/1.jpg", "members/1-doc.pdf"]) assert.equal(fs.existsSync(path.join(dir, f)), false, f);
  assert.equal(fs.existsSync(path.join(dir, "members/b.jpg")), true);
  const n = async (q) => (await db.execute(q)).rows[0].n;
  assert.equal(await n(sql`SELECT count(*)::int AS n FROM admins WHERE id = ${A.id}`), 0);
  assert.equal(await n(sql`SELECT count(*)::int AS n FROM members m JOIN programs p ON p.id = m.program_id WHERE p.admin_id = ${A.id}`), 0);
  assert.equal(await n(sql`SELECT count(*)::int AS n FROM dues WHERE program_id = ${pA.id}`), 0);
  assert.equal(await n(sql`SELECT count(*)::int AS n FROM agents WHERE id = 'AGA'`), 0);
  assert.equal(await n(sql`SELECT count(*)::int AS n FROM accounts WHERE login_id = 'owner-x' AND admin_id IS NULL`), 1);
  assert.equal(await n(sql`SELECT count(*)::int AS n FROM members m JOIN programs p ON p.id = m.program_id WHERE p.admin_id = ${B.id}`), 1);
  await assert.rejects(trustDeleteInfo(A.id), /nahi mila/);
});
