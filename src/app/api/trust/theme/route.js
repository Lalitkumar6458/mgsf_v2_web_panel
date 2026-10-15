import { sql } from "drizzle-orm";
import { db } from "@/db/index.js";
import { route, readJson } from "@/lib/http.js";
import { adminOnly } from "@/lib/access.js";
import { normalizeTheme, DEFAULT_THEME } from "@/lib/theme/themes.js";

/** GET — the trust's colour theme (everyone in the trust; no trust = the default). */
export const GET = route(async ({ auth }) => {
  if (!auth.adminId) return { theme: DEFAULT_THEME };
  const { rows: [r] } = await db.execute(sql`SELECT extra->'theme' AS theme FROM admins WHERE id = ${auth.adminId}`);
  return { theme: normalizeTheme(r?.theme) };
});

/** PATCH { preset, primary?, sidebar? } — Settings → Theme (trust settings edit). */
export const PATCH = route(async ({ request, auth }) => {
  adminOnly(auth);
  const theme = normalizeTheme(await readJson(request));
  await db.execute(sql`UPDATE admins SET extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('theme', ${JSON.stringify(theme)}::jsonb) WHERE id = ${auth.adminId}`);
  return { success: true, theme };
});
