// Master data: the dropdown lists a trust maintains itself (state, district, relation, caste, gotra).
// First read seeds the old built-in lists, so nothing disappears when switching from static data.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { camel } from "../lib/case.js";
import { MASTER_TYPES, masterType } from "../lib/masterTypes.js";
import { states, districtsByState, guardianRelations } from "../lib/staticData.js";

const slug = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_-]/gu, "");

async function ensureSeeded(adminId) {
  const { rows: [a] } = await db.execute(sql`SELECT extra->>'masterSeeded' AS seeded FROM admins WHERE id = ${adminId}`);
  if (!a || a.seeded === "true") return;
  const rows = [];
  states.forEach((s, i) => rows.push(["state", s.value, s.label, "", "", i]));
  for (const [st, list] of Object.entries(districtsByState)) {
    list.forEach((d, i) => rows.push(["district", d.value, d.label, d.label_en || "", st, i]));
  }
  guardianRelations.forEach((r, i) => rows.push(["relation", r.value, r.label, "", "", i]));
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await tx.execute(sql`
        INSERT INTO master_data (id, admin_id, type, value, label, label_en, parent_value, sort_order)
        VALUES ${sql.join(chunk.map(([t, v, l, le, p, o]) => sql`(gen_random_uuid()::text, ${adminId}, ${t}, ${v}, ${l}, ${le}, ${p}, ${o})`), sql`, `)}
        ON CONFLICT DO NOTHING`);
    }
    await tx.execute(sql`UPDATE admins SET extra = extra || '{"masterSeeded": true}'::jsonb WHERE id = ${adminId}`);
  });
}

/** All lists, grouped by type: { state: [...], district: [...], relation: [...], caste: [...], gotra: [...] } */
export async function listMasterData(adminId, { includeInactive = false, withUsage = false } = {}) {
  await ensureSeeded(adminId);
  const { rows } = await db.execute(sql`
    SELECT id, type, value, label, label_en, parent_value, sort_order, active
    FROM master_data WHERE admin_id = ${adminId} ${includeInactive ? sql`` : sql`AND active`}
    ORDER BY type, parent_value, sort_order, label`);
  const out = Object.fromEntries(MASTER_TYPES.map((t) => [t.key, []]));
  for (const r of camel(rows)) (out[r.type] ||= []).push(r);
  if (withUsage) {
    const usage = await usageCounts(adminId);
    for (const [type, list] of Object.entries(out)) list.forEach((r) => { r.used = usage[type]?.[`${r.parentValue}|${r.value}`] ?? usage[type]?.[r.value] ?? 0; });
  }
  return out;
}

/** How many members use each value (so the admin sees what is safe to delete). */
async function usageCounts(adminId) {
  const out = {};
  for (const t of MASTER_TYPES) {
    if (!t.memberColumn) continue;
    const col = sql.raw(`m.${t.memberColumn}`);
    const key = t.key === "district" ? sql`m.state || '|' || m.district` : col;
    const { rows } = await db.execute(sql`
      SELECT ${key} AS k, count(*)::int AS n FROM members m JOIN programs p ON p.id = m.program_id
      WHERE p.admin_id = ${adminId} AND NOT m.deleted AND ${col} <> '' GROUP BY 1`);
    out[t.key] = Object.fromEntries(rows.map((r) => [r.k, r.n]));
  }
  return out;
}

function cleanItem(type, body) {
  const t = masterType(type);
  if (!t) throw badRequest(`Unknown list "${type}"`);
  const label = String(body.label || "").trim();
  if (!label) throw badRequest("Name required");
  const labelEn = String(body.labelEn || "").trim();
  // states / districts are stored on members by an English key ("rajasthan"); the rest by the text itself
  const value = String(body.value || "").trim() || (t.slugValue ? slug(labelEn || label) : label);
  const parentValue = t.parent ? String(body.parentValue || "").trim() : "";
  if (t.parent && !parentValue) throw badRequest(`Choose the ${t.parent}`);
  return { t, label, labelEn, value, parentValue, sortOrder: Number(body.sortOrder) || 0 };
}

export async function addMasterItems(adminId, type, items) {
  await ensureSeeded(adminId);
  const list = items.map((b) => cleanItem(type, b));
  if (!list.length) throw badRequest("Nothing to add");
  const { rows: [{ max }] } = await db.execute(sql`
    SELECT COALESCE(max(sort_order), 0)::int AS max FROM master_data WHERE admin_id = ${adminId} AND type = ${type}`);
  let order = max;
  const added = [];
  for (const it of list) {
    const r = await db.execute(sql`
      INSERT INTO master_data (id, admin_id, type, value, label, label_en, parent_value, sort_order)
      VALUES (gen_random_uuid()::text, ${adminId}, ${type}, ${it.value}, ${it.label}, ${it.labelEn}, ${it.parentValue}, ${it.sortOrder || ++order})
      ON CONFLICT (admin_id, type, parent_value, value) DO UPDATE SET active = true, label = EXCLUDED.label, updated_at = now()
      RETURNING id, type, value, label, label_en, parent_value, sort_order, active`);
    added.push(camel(r.rows[0]));
  }
  return added;
}

async function getItem(adminId, id) {
  const { rows: [r] } = await db.execute(sql`SELECT * FROM master_data WHERE id = ${id} AND admin_id = ${adminId}`);
  if (!r) throw notFound("Item not found");
  return r;
}

/** Label / English name / order / active can change; the stored value cannot (members point to it). */
export async function updateMasterItem(adminId, id, body) {
  await getItem(adminId, id);
  const { rows: [r] } = await db.execute(sql`
    UPDATE master_data SET
      label = COALESCE(NULLIF(${body.label === undefined ? null : String(body.label).trim()}, ''), label),
      label_en = COALESCE(${body.labelEn === undefined ? null : String(body.labelEn).trim()}, label_en),
      sort_order = COALESCE(${body.sortOrder === undefined ? null : Number(body.sortOrder) || 0}, sort_order),
      active = COALESCE(${body.active === undefined ? null : !!body.active}, active),
      updated_at = now()
    WHERE id = ${id} RETURNING id, type, value, label, label_en, parent_value, sort_order, active`);
  return camel(r);
}

export async function deleteMasterItem(adminId, id) {
  const it = await getItem(adminId, id);
  const t = masterType(it.type);
  if (t?.memberColumn) {
    const col = sql.raw(`m.${t.memberColumn}`);
    const { rows: [u] } = await db.execute(sql`
      SELECT count(*)::int AS n FROM members m JOIN programs p ON p.id = m.program_id
      WHERE p.admin_id = ${adminId} AND NOT m.deleted AND ${col} = ${it.value}
        ${t.key === "district" ? sql`AND m.state = ${it.parent_value}` : sql``}`);
    if (u.n > 0) throw conflict(`${u.n} members use "${it.label}". Ise delete nahi kar sakte — Inactive kar dijiye.`);
  }
  if (it.type === "state") {
    const { rows: [d] } = await db.execute(sql`
      SELECT count(*)::int AS n FROM master_data WHERE admin_id = ${adminId} AND type = 'district' AND parent_value = ${it.value}`);
    if (d.n > 0) throw conflict(`Is state ke ${d.n} districts hain — pehle unhe hatayein ya state ko Inactive karein.`);
  }
  await db.execute(sql`DELETE FROM master_data WHERE id = ${id}`);
  return { success: true };
}
