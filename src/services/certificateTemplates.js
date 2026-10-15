// Certificate builder designs — one small list per trust (a default + maybe one per yojna).
// Ported from gsmsy-web-panel (server/domain/certificateTemplates.js) onto Postgres.
//
// Rules kept from there:
//   • exactly one template per trust may be the default, and one per yojna — enforced here in the
//     same transaction as the save (and by partial unique indexes, migration 0007);
//   • the frame is an uploaded file URL, never a base64 data URL in the row.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { badRequest, notFound } from "../lib/errors.js";
import { camel } from "../lib/case.js";
import { normalizeTemplate, stripUndefined } from "../lib/certificateTemplate.js";

const COLS = sql`id, name, is_default, program_id, page, art, bg, frame_img, elements, updated_at`;

function out(row) {
  const r = camel(row);
  return normalizeTemplate({
    id: r.id,
    name: r.name,
    isDefault: r.isDefault === true,
    programId: r.programId ?? null,
    page: r.page,
    art: r.art,
    bg: r.bg,
    frameImg: r.frameImg || "",
    elements: Array.isArray(r.elements) && r.elements.length ? r.elements : undefined,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).getTime() : null,
  });
}

export async function listTemplates(adminId) {
  const { rows } = await db.execute(sql`
    SELECT ${COLS} FROM certificate_templates WHERE admin_id = ${adminId} ORDER BY updated_at DESC`);
  return rows.map(out);
}

export async function getTemplate(adminId, id) {
  const { rows: [r] } = await db.execute(sql`
    SELECT ${COLS} FROM certificate_templates WHERE id = ${id} AND admin_id = ${adminId}`);
  if (!r) throw notFound("Template nahi mila");
  return out(r);
}

/**
 * The template a member's certificate prints with: the one bound to this yojna, else the trust's
 * default, else null — and null means "print the built-in certificate", so a trust that never
 * opens the builder still gets one.
 */
export async function getActiveTemplate(adminId, programId) {
  const { rows: [r] } = await db.execute(sql`
    SELECT ${COLS} FROM certificate_templates
    WHERE admin_id = ${adminId} AND (is_default OR (${programId || null}::text IS NOT NULL AND program_id = ${programId || null}))
    ORDER BY (program_id IS NOT DISTINCT FROM ${programId || null}) DESC, is_default DESC
    LIMIT 1`);
  return r ? out(r) : null;
}

/** Only http(s) or our own /api/files/ URLs — a data URL would put megabytes into every read. */
function cleanFrame(frameImg) {
  const s = String(frameImg || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || s.startsWith("/api/files/")) return s;
  throw badRequest("Image pehle upload karein (data URL nahi chalega)");
}

function cleanInput(input = {}) {
  const elements = Array.isArray(input.elements) ? input.elements : [];
  if (elements.length > 400) throw badRequest("Bahut zyada elements (max 400)");
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return stripUndefined({
    name: String(input.name || "").trim().slice(0, 120) || "Bina naam ka template",
    isDefault: Boolean(input.isDefault),
    programId: input.programId || null,
    page: { wmm: num(input.page?.wmm, 210), hmm: num(input.page?.hmm, 148) },
    art: { w: num(input.art?.w, 1104), h: num(input.art?.h, 739) },
    frameImg: cleanFrame(input.frameImg),
    bg: { color: /^#[0-9a-f]{6}$/i.test(input.bg?.color || "") ? input.bg.color : "#ffffff" },
    elements: elements
      .filter((e) => e && typeof e === "object" && e.id && e.type)
      .map((e) => (e.type === "picture" ? { ...e, src: cleanFrame(e.src) } : e)),
  });
}

async function assertProgram(tx, adminId, programId) {
  if (!programId) return;
  const { rows: [p] } = await tx.execute(sql`SELECT 1 FROM programs WHERE id = ${programId} AND admin_id = ${adminId}`);
  if (!p) throw badRequest("Yojna nahi mili");
}

/** Create (no id) or replace (id) a template. */
export async function saveTemplate(adminId, input, id = null, accountId = "") {
  const t = cleanInput(input);
  const newId = await db.transaction(async (tx) => {
    await assertProgram(tx, adminId, t.programId);
    if (id) {
      const { rows: [ex] } = await tx.execute(sql`SELECT 1 FROM certificate_templates WHERE id = ${id} AND admin_id = ${adminId} FOR UPDATE`);
      if (!ex) throw notFound("Template nahi mila");
    }
    // free the default / yojna slot first so the unique indexes never trip
    if (t.isDefault) {
      await tx.execute(sql`UPDATE certificate_templates SET is_default = false, updated_at = now()
        WHERE admin_id = ${adminId} AND is_default AND id IS DISTINCT FROM ${id}`);
    }
    if (t.programId) {
      await tx.execute(sql`UPDATE certificate_templates SET program_id = NULL, updated_at = now()
        WHERE program_id = ${t.programId} AND id IS DISTINCT FROM ${id}`);
    }
    const page = JSON.stringify(t.page), art = JSON.stringify(t.art), bg = JSON.stringify(t.bg), els = JSON.stringify(t.elements);
    if (id) {
      await tx.execute(sql`
        UPDATE certificate_templates SET name = ${t.name}, is_default = ${t.isDefault}, program_id = ${t.programId},
          page = ${page}::jsonb, art = ${art}::jsonb, bg = ${bg}::jsonb, frame_img = ${t.frameImg}, elements = ${els}::jsonb,
          updated_by = ${accountId || ""}, updated_at = now()
        WHERE id = ${id}`);
      return id;
    }
    const { rows: [r] } = await tx.execute(sql`
      INSERT INTO certificate_templates (id, admin_id, name, is_default, program_id, page, art, bg, frame_img, elements, created_by, updated_by)
      VALUES (gen_random_uuid()::text, ${adminId}, ${t.name}, ${t.isDefault}, ${t.programId}, ${page}::jsonb, ${art}::jsonb, ${bg}::jsonb,
        ${t.frameImg}, ${els}::jsonb, ${accountId || ""}, ${accountId || ""})
      RETURNING id`);
    return r.id;
  });
  return getTemplate(adminId, newId);
}

/** Make this the default without resending the whole design. */
export async function setDefaultTemplate(adminId, id, accountId = "") {
  await db.transaction(async (tx) => {
    const { rows: [ex] } = await tx.execute(sql`SELECT 1 FROM certificate_templates WHERE id = ${id} AND admin_id = ${adminId} FOR UPDATE`);
    if (!ex) throw notFound("Template nahi mila");
    await tx.execute(sql`UPDATE certificate_templates SET is_default = false, updated_at = now() WHERE admin_id = ${adminId} AND is_default AND id <> ${id}`);
    await tx.execute(sql`UPDATE certificate_templates SET is_default = true, updated_by = ${accountId || ""}, updated_at = now() WHERE id = ${id}`);
  });
  return getTemplate(adminId, id);
}

/** Layout, not money — deleting only changes how the next certificate looks. */
export async function deleteTemplate(adminId, id) {
  const { rowCount } = await db.execute(sql`DELETE FROM certificate_templates WHERE id = ${id} AND admin_id = ${adminId}`);
  if (!rowCount) throw notFound("Template nahi mila");
  return { id };
}
