// Trust staff users and their roles.
//  - The trust's own admin login (role_id NULL) is the Super Admin: all access, cannot be edited here.
//  - Staff users are admin logins with a role. A staff user who manages users can only hand out
//    permissions he has himself, and cannot change his own role.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { hashPassword } from "../lib/auth.js";
import { camel } from "../lib/case.js";
import { normalizePermissions, can, MODULES } from "../lib/permissions.js";

function assertGrantable(auth, permissions) {
  if (!auth?.access || auth.access.isSuper) return;
  for (const [mod, acts] of Object.entries(permissions)) {
    for (const a of acts) {
      if (!can(auth.access, mod, a)) {
        const m = MODULES.find((x) => x.key === mod);
        throw forbidden(`Aap ${m?.label || mod} — ${a} khud nahi kar sakte, isliye kisi role ko bhi nahi de sakte`);
      }
    }
  }
}

// ─── roles ─────────────────────────────────────────────────────────────────
export async function listRoles(adminId) {
  const { rows } = await db.execute(sql`
    SELECT r.id, r.name, r.description, r.permissions, r.created_at, r.updated_at,
      (SELECT count(*)::int FROM accounts a WHERE a.role_id = r.id) AS users
    FROM roles r WHERE r.admin_id = ${adminId} ORDER BY lower(r.name)`);
  return camel(rows).map((r) => ({ ...r, permissions: normalizePermissions(r.permissions) }));
}

async function getRole(adminId, roleId) {
  const { rows: [r] } = await db.execute(sql`SELECT * FROM roles WHERE id = ${roleId} AND admin_id = ${adminId}`);
  if (!r) throw notFound("Role not found");
  return r;
}

function roleFields(body) {
  const name = String(body.name || "").trim();
  if (!name) throw badRequest("Role name required");
  if (/^super\s*admin$/i.test(name)) throw badRequest('"Super Admin" naam reserved hai');
  return { name, description: String(body.description || "").trim(), permissions: normalizePermissions(body.permissions) };
}

export async function createRole(adminId, body, auth) {
  const f = roleFields(body);
  assertGrantable(auth, f.permissions);
  try {
    const { rows: [r] } = await db.execute(sql`
      INSERT INTO roles (id, admin_id, name, description, permissions)
      VALUES (gen_random_uuid()::text, ${adminId}, ${f.name}, ${f.description}, ${JSON.stringify(f.permissions)}::jsonb)
      RETURNING *`);
    return camel(r);
  } catch (e) {
    if (e?.cause?.code === "23505" || e?.code === "23505") throw conflict(`Role "${f.name}" already exists`);
    throw e;
  }
}

export async function updateRole(adminId, roleId, body, auth) {
  await getRole(adminId, roleId);
  if (auth?.access && !auth.access.isSuper && auth.access.roleId === roleId) throw forbidden("Aap apna khud ka role nahi badal sakte");
  const f = roleFields(body);
  assertGrantable(auth, f.permissions);
  try {
    const { rows: [r] } = await db.execute(sql`
      UPDATE roles SET name = ${f.name}, description = ${f.description}, permissions = ${JSON.stringify(f.permissions)}::jsonb, updated_at = now()
      WHERE id = ${roleId} RETURNING *`);
    return camel(r);
  } catch (e) {
    if (e?.cause?.code === "23505" || e?.code === "23505") throw conflict(`Role "${f.name}" already exists`);
    throw e;
  }
}

export async function deleteRole(adminId, roleId) {
  const r = await getRole(adminId, roleId);
  const { rows: [u] } = await db.execute(sql`SELECT count(*)::int AS n FROM accounts WHERE role_id = ${roleId}`);
  if (u.n > 0) throw conflict(`${u.n} users have the role "${r.name}". Pehle unka role badlein.`);
  await db.execute(sql`DELETE FROM roles WHERE id = ${roleId}`);
  return { success: true };
}

// ─── users ─────────────────────────────────────────────────────────────────
export async function listUsers(adminId) {
  const { rows } = await db.execute(sql`
    SELECT a.id, a.display_name, a.email, a.login_id, a.phone, a.active, a.last_login_at, a.created_at, a.role_id,
      r.name AS role_name, (a.role_id IS NULL) AS is_super
    FROM accounts a LEFT JOIN roles r ON r.id = a.role_id
    WHERE a.admin_id = ${adminId} AND a.role = 'admin'
    ORDER BY (a.role_id IS NULL) DESC, lower(a.display_name)`);
  return camel(rows);
}

async function getStaff(adminId, id) {
  const { rows: [a] } = await db.execute(sql`SELECT * FROM accounts WHERE id = ${id} AND admin_id = ${adminId} AND role = 'admin'`);
  if (!a) throw notFound("User not found");
  return a;
}

export async function createUser(adminId, body, auth) {
  const displayName = String(body.displayName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  if (!displayName) throw badRequest("Name required");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw badRequest("Valid email required (used for login)");
  if (!body.password || String(body.password).length < 6) throw badRequest("Password (6+ characters) required");
  if (!body.roleId) throw badRequest("Choose a role");
  const role = await getRole(adminId, body.roleId);
  assertGrantable(auth, normalizePermissions(role.permissions));
  const { rows: taken } = await db.execute(sql`SELECT 1 FROM accounts WHERE login_id = ${email}`);
  if (taken.length) throw conflict("Ye email pehle se kisi login mein use ho raha hai");
  const { rows: [a] } = await db.execute(sql`
    INSERT INTO accounts (id, role, login_id, email, phone, display_name, password_hash, admin_id, role_id)
    VALUES (gen_random_uuid()::text, 'admin', ${email}, ${email}, ${String(body.phone || "")}, ${displayName},
      ${await hashPassword(body.password)}, ${adminId}, ${role.id})
    RETURNING id`);
  return { success: true, id: a.id };
}

export async function updateUser(adminId, id, body, auth) {
  const a = await getStaff(adminId, id);
  if (!a.role_id) throw forbidden("Super Admin ko yahan se nahi badal sakte (Settings → Security se apna password badlein)");
  const self = auth?.accountId === id;
  if (self && body.roleId !== undefined && body.roleId !== a.role_id) throw forbidden("Aap apna khud ka role nahi badal sakte");
  if (self && body.active === false) throw forbidden("Aap khud ko inactive nahi kar sakte");
  let roleId = a.role_id;
  if (body.roleId !== undefined && body.roleId !== a.role_id) {
    const role = await getRole(adminId, body.roleId);
    assertGrantable(auth, normalizePermissions(role.permissions));
    roleId = role.id;
  }
  const email = body.email !== undefined ? String(body.email).trim().toLowerCase() : a.email;
  if (email !== a.email) {
    if (!/^\S+@\S+\.\S+$/.test(email)) throw badRequest("Valid email required");
    const { rows: taken } = await db.execute(sql`SELECT 1 FROM accounts WHERE login_id = ${email} AND id <> ${id}`);
    if (taken.length) throw conflict("Ye email pehle se kisi login mein use ho raha hai");
  }
  if (body.password !== undefined && body.password !== "" && String(body.password).length < 6) throw badRequest("Password (6+ characters)");
  const hash = body.password ? await hashPassword(body.password) : null;
  await db.execute(sql`
    UPDATE accounts SET
      display_name = ${body.displayName !== undefined ? String(body.displayName).trim() || a.display_name : a.display_name},
      phone = ${body.phone !== undefined ? String(body.phone) : a.phone},
      email = ${email}, login_id = ${email}, role_id = ${roleId},
      active = ${body.active !== undefined ? !!body.active : a.active},
      password_hash = COALESCE(${hash}, password_hash), updated_at = now()
    WHERE id = ${id}`);
  // deactivated or password changed → log out everywhere
  if (body.active === false || hash) await db.execute(sql`UPDATE sessions SET revoked_at = now() WHERE account_id = ${id} AND revoked_at IS NULL`);
  return { success: true };
}

export async function deleteUser(adminId, id, auth) {
  const a = await getStaff(adminId, id);
  if (!a.role_id) throw forbidden("Super Admin ko delete nahi kar sakte");
  if (auth?.accountId === id) throw forbidden("Aap khud ko delete nahi kar sakte");
  await db.execute(sql`DELETE FROM accounts WHERE id = ${id}`);
  return { success: true };
}
