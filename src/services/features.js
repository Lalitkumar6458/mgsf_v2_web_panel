// Feature lock storage: admins.extra.features (see lib/features.js).
// getAuth() reads it on every request, so it is cached here for a short time; saving clears it.
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { normalizeFeatures } from "../lib/features.js";
import { notFound } from "../lib/errors.js";

const TTL_MS = 30_000;
const g = globalThis;
const cache = (g.__mgsfFeatures ??= new Map()); // adminId → { at, value }

export async function getTrustFeatures(adminId) {
  if (!adminId) return normalizeFeatures(null);
  const hit = cache.get(adminId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { rows: [r] } = await db.execute(sql`SELECT extra->'features' AS f FROM admins WHERE id = ${adminId}`);
  const value = normalizeFeatures(r?.f);
  cache.set(adminId, { at: Date.now(), value });
  return value;
}

/** Replace a trust's feature lock. input = { flags, active, message } */
export async function saveTrustFeatures(adminId, input, by = "control") {
  const next = normalizeFeatures({ ...input, updatedAt: new Date().toISOString() });
  const value = { ...next, updatedBy: by };
  const { rowCount } = await db.execute(sql`
    UPDATE admins SET extra = jsonb_set(coalesce(extra, '{}'::jsonb), '{features}', ${JSON.stringify(value)}::jsonb), updated_at = now()
    WHERE id = ${adminId}`);
  if (!rowCount) throw notFound("Trust nahi mila");
  cache.delete(adminId);
  return next;
}

/** All trusts with their lock, for the control page. */
export async function listTrustFeatures() {
  const { rows } = await db.execute(sql`
    SELECT ad.id, ad.display_name, ad.email, ad.phone, ad.created_at, ad.trust_info->>'name' AS trust_name,
      ad.extra->'features' AS features,
      (SELECT max(last_login_at) FROM accounts a WHERE a.admin_id = ad.id AND a.role = 'admin') AS last_login_at,
      (SELECT count(*) FROM programs p WHERE p.admin_id = ad.id)::int AS programs,
      (SELECT count(*) FROM members m JOIN programs p ON p.id = m.program_id WHERE p.admin_id = ad.id AND NOT m.deleted)::int AS members,
      (SELECT count(*) FROM agents ag WHERE ag.admin_id = ad.id)::int AS agents
    FROM admins ad ORDER BY ad.created_at`);
  return rows.map((r) => ({
    id: r.id,
    name: r.trust_name || r.display_name || r.email,
    displayName: r.display_name,
    email: r.email,
    phone: r.phone,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
    programs: r.programs,
    members: r.members,
    agents: r.agents,
    features: normalizeFeatures(r.features),
  }));
}

export const clearFeatureCache = () => cache.clear();
