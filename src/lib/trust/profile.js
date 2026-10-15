// One source of truth for the trust's branding (name, address, logos, header, stamp…).
// Used by every screen and every PDF — browser and server. Change it in
// Settings → Organization and all of them pick it up.
//
// Stored on admins.trust_info (JSON). Anything not set there falls back to TRUST_DEFAULTS.
// Plain module (no "@/" imports): also loaded by node (server services, tests).

export const TRUST_TEXT_FIELDS = [
  "name",           // full trust name (PDF header, certificate, footer)
  "shortName",      // short name for sidebar / browser tab, e.g. "MGSF"
  "cityState",
  "address",
  "contact",        // phone numbers, "9999999999 / 8888888888"
  "contactPerson",
  "trustPresident",
  "founder",        // receipts: "संथापक : …" bar
  "signatoryName",  // receipts: name under the signature when no stamp image
  "stampText",      // receipts: text inside the round stamp when no stamp image
  "email",
  "website",
  "regNo",
  "govtRegNo",
  "about",
];

export const TRUST_IMAGE_FIELDS = ["logo", "RightLogo", "headerImg", "stampImg", "banner"];

/** "auto" = PDF header drawn from name/address/logos (always up to date); "image" = uploaded header picture */
export const HEADER_MODES = ["auto", "image"];

// Shown until the trust fills Settings → Organization: a neutral name, nothing else.
export const DEFAULT_TRUST_NAME = "Trust Manager";

export const  TRUST_DEFAULTS = {
  name: DEFAULT_TRUST_NAME,
  shortName: "",          // empty → the full name is used
  cityState: "",
  address: "",
  contact: "",
  contactPerson: "",
  trustPresident: "",
  founder: "",
  signatoryName: "",
  stampText: "",
  email: "",
  website: "",
  regNo: "",
  govtRegNo: "",
  about: "",
  topTitle: [],
  logo: null,
  RightLogo: null,
  headerImg: null,
  stampImg: null,
  banner: null,
  headerMode: "auto",
};

const isStr = (v) => typeof v === "string";

function toTitles(v) {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean);
  if (isStr(v)) return v.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
  return null;
}

/**
 * Raw trust_info (whatever was saved, old Firestore shape included) → full profile.
 * Text: a saved string wins (even ""), otherwise the default.
 * Images: a saved value wins, otherwise the default.
 */
export function normalizeTrust(info) {
  const raw = info && typeof info === "object" ? info : {};
  const out = {};
  for (const k of TRUST_TEXT_FIELDS) out[k] = isStr(raw[k]) ? raw[k] : TRUST_DEFAULTS[k];
  // old Firestore trustInfo used "trustName"
  out.name = (isStr(raw.name) && raw.name.trim()) || (isStr(raw.trustName) && raw.trustName.trim()) || DEFAULT_TRUST_NAME;

  out.topTitle = toTitles(raw.topTitle) ?? TRUST_DEFAULTS.topTitle;

  // old panel saved the stamp as "trustStamp"
  const stamp = raw.stampImg || raw.trustStamp;
  out.logo = raw.logo || TRUST_DEFAULTS.logo;
  out.RightLogo = raw.RightLogo || out.logo;           // right-side logo defaults to the main logo
  out.isDefault = out.name === DEFAULT_TRUST_NAME && !(isStr(raw.name) && raw.name.trim());         // nothing saved yet
  out.headerImg = raw.headerImg || null;
  out.stampImg = stamp || null;
  out.banner = raw.banner || null;
  out.headerMode = HEADER_MODES.includes(raw.headerMode) ? raw.headerMode : TRUST_DEFAULTS.headerMode;

  out.updatedAt = raw.updatedAt || null;
  return out;
}

/** What Settings → Organization is allowed to save (images are URLs from /api/upload) */
export function pickTrustInput(body) {
  const out = {};
  for (const k of TRUST_TEXT_FIELDS) if (body[k] !== undefined && body[k] !== null) out[k] = String(body[k]);
  if (body.topTitle !== undefined) out.topTitle = toTitles(body.topTitle) || [];
  for (const k of TRUST_IMAGE_FIELDS) {
    if (body[k] === undefined) continue;
    const v = body[k];
    // only real uploads/URLs are stored; null clears back to the default
    out[k] = v && isStr(v) && !v.startsWith("data:") ? v : null;
  }
  if (HEADER_MODES.includes(body.headerMode)) out.headerMode = body.headerMode;
  return out;
}

/** Plain text line under the name: "रजिस्ट्रेशन 11637" */
export function regLine(t) {
  return t?.regNo ? `रजिस्ट्रेशन ${t.regNo}` : "";
}

/** Name for sidebar / browser tab / app: short name if set, else the full name */
export function displayName(t) {
  return (t?.shortName || "").trim() || (t?.name || "").trim() || DEFAULT_TRUST_NAME;
}

/** "Mera Ghanchi Samaj" → "MG" (avatar when there is no logo) */
export function initials(t) {
  const n = displayName(t).replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((n[0]?.[0] || "T") + (n[1]?.[0] || "")).toUpperCase();
}
