// Server side trust profile: read from the DB, fill defaults, and turn image URLs into
// data: URIs so @react-pdf can draw them without any network call.
import { eq, asc } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, schema } from "../db/index.js";
import { readLocalUpload } from "../lib/storage.js";
import { normalizeTrust, pickTrustInput, TRUST_IMAGE_FIELDS } from "../lib/trust/profile.js";

const imageCache = new Map(); // url → data URI (uploads are immutable: new upload = new URL)

async function toDataUri(src) {
  if (!src || typeof src !== "string" || src.startsWith("data:")) return src;
  if (imageCache.has(src)) return imageCache.get(src);
  let out = null;
  try {
    const filesAt = src.indexOf("/api/files/");
    if (filesAt !== -1) {
      const f = await readLocalUpload(decodeURIComponent(src.slice(filesAt + "/api/files/".length)));
      if (f) out = `data:${f.type};base64,${f.data.toString("base64")}`;
    } else if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src);
      if (res.ok) {
        const type = res.headers.get("content-type") || "image/png";
        out = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
      }
    } else if (src.startsWith("/")) {
      // file shipped in /public, e.g. /Images/logo.jpg
      const full = path.join(process.cwd(), "public", src);
      const ext = path.extname(full).slice(1).toLowerCase();
      const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
      out = `data:${type};base64,${(await readFile(full)).toString("base64")}`;
    }
  } catch (e) {
    console.error("trust image load failed:", src, e.message);
  }
  if (out) imageCache.set(src, out);
  return out;
}

async function loadRaw(adminId) {
  if (!adminId) return null;
  return db.query.admins.findFirst({ where: eq(schema.admins.id, adminId) });
}

/** Full profile for PDFs. inlineImages=true → every image is a data: URI (or null). */
export async function getTrustProfile(adminId, { inlineImages = true } = {}) {
  const row = await loadRaw(adminId);
  const t = normalizeTrust(row?.trustInfo);
  if (inlineImages) {
    for (const k of TRUST_IMAGE_FIELDS) {
      if (!t[k]) continue;
      const v = await toDataUri(t[k]);
      t[k] = v || null;
    }
    if (!t.RightLogo) t.RightLogo = t.logo;
  }
  return t;
}

/** Save Settings → Organization. Returns the stored trust_info. */
export async function updateTrustInfo(adminId, body, byAccountId) {
  const row = await loadRaw(adminId);
  const next = {
    ...(row?.trustInfo || {}),
    ...pickTrustInput(body || {}),
    updatedAt: new Date().toISOString(),
    updatedBy: byAccountId || null,
  };
  delete next.trustStamp; // old key, now stampImg
  if (row?.trustInfo?.trustStamp && next.stampImg === undefined) next.stampImg = row.trustInfo.trustStamp;
  const patch = { trustInfo: next };
  if (typeof body?.name === "string" && body.name.trim()) patch.displayName = body.name.trim();
  await db.update(schema.admins).set(patch).where(eq(schema.admins.id, adminId));
  return next;
}

/** Branding shown before login (the panel serves one trust; with several, the oldest one). */
export async function publicBranding() {
  const row = await db.query.admins.findFirst({ orderBy: [asc(schema.admins.createdAt)] });
  const t = normalizeTrust(row?.trustInfo);
  const raw = row?.trustInfo || {};
  return {
    name: t.name,
    shortName: t.shortName,
    cityState: t.cityState,
    // only an uploaded logo is sent; the built-in one is already in the page bundle
    logo: raw.logo && !String(raw.logo).startsWith("data:") ? raw.logo : null,
  };
}
