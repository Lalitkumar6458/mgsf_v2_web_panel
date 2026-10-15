// Roles / staff users / API permission map / master data.  npm test
import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/index.js";
import { apiPermission, allowed, can, normalizePermissions, pageModule } from "../src/lib/permissions.js";
import { assertApiAccess } from "../src/lib/apiAccess.js";
import { createRole, updateRole, deleteRole, createUser, updateUser, deleteUser, listUsers } from "../src/services/users.js";
import { listMasterData, addMasterItems, updateMasterItem, deleteMasterItem } from "../src/services/masterData.js";

let admin, program, superAccount;
const superAuth = () => ({ role: "admin", adminId: admin.id, accountId: superAccount.id, access: { isSuper: true } });
const req = (method, path) => ({ method, url: `http://x${path}` });
const staff = (permissions, extra = {}) => ({ role: "admin", adminId: admin.id, accountId: "staff", access: { isSuper: false, permissions: normalizePermissions(permissions), roleName: "Test", ...extra } });

before(async () => {
  await db.execute(sql`TRUNCATE admins, accounts, sessions, otps RESTART IDENTITY CASCADE`);
  [admin] = await db.insert(schema.admins).values({ email: "r@test.in", displayName: "T" }).returning();
  [program] = await db.insert(schema.programs).values({ adminId: admin.id, name: "Vivah" }).returning();
  [superAccount] = await db.insert(schema.accounts).values({ role: "admin", loginId: "r@test.in", passwordHash: "x", adminId: admin.id, displayName: "Owner" }).returning();
  await db.insert(schema.members).values([
    { id: "u1", programId: program.id, dateJoin: "2026-01-01", status: "accepted", state: "rajasthan", district: "jodhpur", guardianRelation: "पिता-पुत्र", jati: "घांची" },
  ]);
});
after(() => pool.end());

test("permission map: screens and API calls", () => {
  assert.deepEqual(normalizePermissions({ members: ["add"], bogus: ["view"], dashboard: ["delete"] }), { members: ["view", "add"] });
  assert.deepEqual(apiPermission("POST", "/api/programs/P1/members"), { module: "members", action: "add" });
  assert.deepEqual(apiPermission("DELETE", "/api/members/m1/closing"), { module: "closings", action: "delete" });
  assert.deepEqual(apiPermission("POST", "/api/transactions/t1/reverse"), { module: "payments", action: "delete" });
  assert.deepEqual(apiPermission("PATCH", "/api/trust"), { module: "settings", action: "edit" });
  assert.equal(apiPermission("GET", "/api/trust"), null);
  assert.equal(apiPermission("GET", "/api/master-data"), null);
  assert.equal(apiPermission("GET", "/api/programs"), null);
  const viewer = staff({ members: ["view"] });
  assert.equal(allowed(viewer.access, apiPermission("GET", "/api/agents")), true); // agent list feeds member screens
  assert.equal(allowed(viewer.access, apiPermission("POST", "/api/agents")), false);
  assert.equal(can({ isSuper: true }, "users", "delete"), true);
  assert.equal(pageModule("/closedMembers"), "closings");
  assert.equal(pageModule("/"), "dashboard");
});

test("route guard: staff blocked outside their role, super admin and agents not limited here", () => {
  const s = staff({ members: ["view", "add"] });
  assert.doesNotThrow(() => assertApiAccess(s, req("POST", "/api/programs/P1/members")));
  assert.throws(() => assertApiAccess(s, req("DELETE", "/api/members/x")), /Members — delete/);
  assert.throws(() => assertApiAccess(s, req("POST", "/api/payments/process")), /permission/);
  assert.doesNotThrow(() => assertApiAccess(superAuth(), req("DELETE", "/api/members/x")));
  assert.doesNotThrow(() => assertApiAccess({ role: "agent" }, req("POST", "/api/payments/process")));
});

test("roles + staff users; staff cannot hand out more than they have", async () => {
  const r = await createRole(admin.id, { name: "Data entry", permissions: { members: ["add", "edit"], users: ["view", "add"] } }, superAuth());
  assert.deepEqual(r.permissions, { members: ["view", "add", "edit"], users: ["view", "add"] });
  await assert.rejects(createRole(admin.id, { name: "data ENTRY" }, superAuth()), /already exists/);
  await assert.rejects(createRole(admin.id, { name: "Super Admin" }, superAuth()), /reserved/);

  const u = await createUser(admin.id, { displayName: "Ravi", email: "Ravi@T.in", password: "secret1", roleId: r.id }, superAuth());
  const list = await listUsers(admin.id);
  assert.equal(list[0].isSuper, true);
  assert.equal(list.find((x) => x.id === u.id).roleName, "Data entry");
  await assert.rejects(createUser(admin.id, { displayName: "X", email: "ravi@t.in", password: "secret1", roleId: r.id }, superAuth()), /pehle se/);

  const ravi = staff(r.permissions, { roleId: r.id });
  ravi.accountId = u.id;
  await assert.rejects(createRole(admin.id, { name: "Cash", permissions: { payments: ["add"] } }, ravi), /khud nahi kar sakte/);
  await assert.rejects(updateRole(admin.id, r.id, { name: "Data entry", permissions: { members: ["delete"] } }, ravi), /apna khud ka role/);
  await assert.rejects(updateUser(admin.id, superAccount.id, { active: false }, ravi), /Super Admin/);
  await assert.rejects(updateUser(admin.id, u.id, { active: false }, ravi), /khud ko inactive/);

  await assert.rejects(deleteRole(admin.id, r.id), /users have the role/);
  await updateUser(admin.id, u.id, { active: false }, superAuth());
  await deleteUser(admin.id, u.id, superAuth());
  await deleteRole(admin.id, r.id);
});

test("master data: defaults seeded once, add / bulk, value kept, delete refused when used", async () => {
  const lists = await listMasterData(admin.id, { withUsage: true });
  assert.ok(lists.state.find((s) => s.value === "rajasthan"));
  const jodhpur = lists.district.find((d) => d.value === "jodhpur" && d.parentValue === "rajasthan");
  assert.equal(jodhpur.used, 1);
  assert.ok(lists.relation.length >= 13);
  assert.equal(lists.caste.length, 0);

  const [mp] = await addMasterItems(admin.id, "state", [{ label: "मध्य प्रदेश", labelEn: "Madhya Pradesh" }]);
  assert.equal(mp.value, "madhya_pradesh");
  await addMasterItems(admin.id, "district", [{ label: "इंदौर", labelEn: "Indore", parentValue: "madhya_pradesh" }]);
  await assert.rejects(addMasterItems(admin.id, "district", [{ label: "भोपाल" }]), /Choose the state/);
  const castes = await addMasterItems(admin.id, "caste", [{ label: "घांची" }, { label: "माली" }]);
  assert.equal(castes[0].value, "घांची");

  const ghanchi = castes[0];
  await assert.rejects(deleteMasterItem(admin.id, ghanchi.id), /1 members use/);
  await updateMasterItem(admin.id, ghanchi.id, { active: false, label: "घांची (मोदी)" });
  assert.equal((await listMasterData(admin.id)).caste.length, 1); // inactive hidden from forms
  await deleteMasterItem(admin.id, castes[1].id);
  await assert.rejects(deleteMasterItem(admin.id, mp.id), /districts hain/);

  // deleting everything never re-seeds
  await db.execute(sql`DELETE FROM master_data WHERE admin_id = ${admin.id} AND type = 'relation'`);
  assert.equal((await listMasterData(admin.id)).relation.length, 0);
});
