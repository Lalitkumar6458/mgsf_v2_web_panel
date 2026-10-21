// Server side trust profile: read from the DB, fill defaults, and turn image URLs into
// data: URIs so @react-pdf can draw them without any network call.
import { eq, asc } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, schema } from "../db/index.js";
import { badRequest, notFound } from "../lib/errors.js";
import { readLocalUpload } from "../lib/storage.js";
import { normalizeTrust, pickTrustInput, TRUST_IMAGE_FIELDS } from "../lib/trust/profile.js";

const imageCache = new Map(); // url → data URI (uploads are immutable: new upload = new URL)

export async function toDataUri(src) {
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

/** host of a request (Caddy / proxy sends the real one) — "admin.trust.in" */
export const requestHost = (request) => String(request?.headers?.get("x-forwarded-host") || request?.headers?.get("host") || "")
  .split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
export const normDomain = (d) => String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");

/**
 * Which trust a visitor sees BEFORE login (login page, mobile app welcome).
 * 1. the trust whose "login page domain" (Feature control) is this host
 * 2. else the trust marked as default, else the oldest one.
 */
export async function brandingAdmin(host) {
  const rows = await db.query.admins.findMany({ orderBy: [asc(schema.admins.createdAt)] });
  if (!rows.length) return null;
  const h = normDomain(host);
  const domainsOf = (r) => (Array.isArray(r.extra?.loginDomains) ? r.extra.loginDomains.map(normDomain) : []);
  return (h && rows.find((r) => domainsOf(r).includes(h))) || rows.find((r) => r.extra?.loginDefault === true) || rows[0];
}

/** Branding shown before login (by domain — see brandingAdmin). */
export async function publicBranding(host) {
  const row = await brandingAdmin(host);
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

/** Feature control: set the login-page domains of one trust (each domain belongs to one trust only). */
export async function setLoginDomains(adminId, { domains = [], isDefault } = {}) {
  const list = [...new Set((Array.isArray(domains) ? domains : String(domains).split(/[\s,]+/)).map(normDomain).filter(Boolean))].slice(0, 10);
  for (const d of list) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw badRequest(`Domain galat: ${d}`);
  const rows = await db.query.admins.findMany();
  const me = rows.find((r) => r.id === adminId);
  if (!me) throw notFound("Trust nahi mila");
  for (const r of rows) {
    if (r.id === adminId) continue;
    const clash = (Array.isArray(r.extra?.loginDomains) ? r.extra.loginDomains.map(normDomain) : []).find((d) => list.includes(d));
    if (clash) throw badRequest(`${clash} pehle se "${r.trustInfo?.name || r.displayName || r.email}" ka hai`);
  }
  if (isDefault === true) for (const r of rows) if (r.id !== adminId && r.extra?.loginDefault) await db.update(schema.admins).set({ extra: { ...r.extra, loginDefault: false } }).where(eq(schema.admins.id, r.id));
  const extra = { ...(me.extra || {}), loginDomains: list, ...(isDefault === undefined ? {} : { loginDefault: !!isDefault }) };
  await db.update(schema.admins).set({ extra }).where(eq(schema.admins.id, adminId));
  return { loginDomains: list, loginDefault: !!extra.loginDefault };
}
