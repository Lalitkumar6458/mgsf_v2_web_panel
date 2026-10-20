// Feature lock — what each trust's panel is allowed to use at all (set by the developer on the
// secret /feature-control page, stored in admins.extra.features).
//
// This sits ABOVE roles: a feature switched off here is off for everyone of that trust, the trust's
// super admin included. Roles (lib/permissions.js) then decide which staff user sees what is left.
//
// Pure module — used by the API (lib/auth.js, lib/apiAccess.js), the browser (sidebar, buttons)
// and tests. A feature missing from the stored map is ON, so old trusts keep everything.

/** Screens — each one switches off a whole module of lib/permissions.js (sidebar, page, API). */
export const SCREEN_FEATURES = [
  { key: "dashboard", module: "dashboard", label: "Dashboard", hi: "डैशबोर्ड", desc: "Home page ke numbers aur charts" },
  { key: "members", module: "members", label: "Members", hi: "सदस्य", desc: "Member list, add / edit, requests, block" },
  { key: "agents", module: "agents", label: "Agents", hi: "एजेंट", desc: "Agent list, add / edit, agent detail" },
  { key: "yojna", module: "yojna", label: "Yojna", hi: "योजना", desc: "Yojna add / edit (list sab ko dikhti hai)" },
  { key: "closings", module: "closings", label: "Closing / Closed members", hi: "क्लोजिंग", desc: "Closing record karna, closed members" },
  { key: "payments", module: "payments", label: "Payments", hi: "भुगतान", desc: "Closing payments, payment history, join fees" },
  { key: "reports", module: "reports", label: "Reports", hi: "रिपोर्ट", desc: "Late payments, agent performance, member history" },
  { key: "commission", module: "commission", label: "Agent commission", hi: "कमीशन", desc: "Commission dekhna aur payout" },
  { key: "master", module: "master", label: "Master data", hi: "मास्टर डेटा", desc: "State, district, gotra … dropdown lists" },
  { key: "users", module: "users", label: "Staff users & roles", hi: "यूज़र / रोल", desc: "Trust ke staff logins aur unke roles" },
  { key: "settings", module: "settings", label: "Trust settings", hi: "सेटिंग्स", desc: "Organization details, PDF header, rules" },
];

/** Extra features inside screens, in groups for the control page. `api` = request paths it guards on the server. */
export const EXTRA_FEATURES = [
  // रसीद / PDF
  { group: "rasid", key: "receipts", label: "Receipts (रसीद) PDF", hi: "रसीद", desc: "Rasid PDF banana (agent / payment screens)",
    api: [/^\/rasid-generate$/, /^\/receipts(\/|$)/, /^\/programs\/[^/]+\/receipts$/] },
  { group: "rasid", key: "rasidDesign", label: "Rasid design (Settings)", hi: "रसीद डिज़ाइन", desc: "Size, rang, title, sign — Settings → Rasid design",
    api: [/^\/trust\/receipt-settings$/], writeOnly: true },
  { group: "rasid", key: "upiQr", label: "UPI QR (pending rasid)", hi: "UPI QR", desc: "Baki rasid par scan karke bhugtan wala QR" },
  { group: "rasid", key: "verifyQr", label: "Verify QR (asli/nakli jaanch)", hi: "जाँच QR", desc: "Paid rasid / certificate par QR + verify page",
    api: [/^\/certificate-templates\/verify-codes$/] },
  { group: "rasid", key: "paymentPdf", label: "Payment report PDF", hi: "भुगतान रिपोर्ट PDF", desc: "Payment history / all-payment PDF",
    api: [/^\/programs\/[^/]+\/transactions\/report$/, /^\/all-payment-pdf$/] },
  { group: "rasid", key: "exports", label: "Export (CSV / Excel / PDF list)", hi: "एक्सपोर्ट", desc: "Member / payment list download aur print" },
  // certificate
  { group: "certificate", key: "certificates", label: "Member certificate", hi: "प्रमाण पत्र", desc: "Certificate download / print / bhejna",
    api: [/^\/certificate-send$/, /^\/certificate-templates\/active$/] },
  { group: "certificate", key: "certificateBuilder", label: "Certificate builder", hi: "सर्टिफिकेट डिज़ाइन", desc: "Apna certificate design banana (Settings)",
    api: [/^\/certificate-templates(\/(?!active$|verify-codes$).*)?$/] },
  // members
  { group: "members", key: "duplicateCheck", label: "Duplicate member check", hi: "दोहरा सदस्य जाँच", desc: "Wahi Aadhaar / mobile / naam pehle se ho to warning",
    api: [/^\/members\/duplicates$/] },
  { group: "members", key: "aadhaarMask", label: "Aadhaar chhupa (XXXX 1234)", hi: "आधार मास्क", desc: "List / detail mein Aadhaar ke sirf aakhri 4 ank" },
  { group: "members", key: "dataImport", label: "Excel / CSV import", hi: "एक्सेल इम्पोर्ट", desc: "Members page → Import: Excel / CSV se sadasya, purani closing aur jama payment ek saath (sample file, jaanch, live progress, undo)", api: [/^\/programs\/[^/]+\/import(\/|$)/] },
  { group: "members", key: "blankForm", label: "Khaali registration form", hi: "खाली फॉर्म", desc: "Print karke haath se bharne wala form" },
  { group: "members", key: "countDisplay", label: "Member count display", hi: "सदस्य संख्या", desc: "Yojna mein percent / fixed count dikhane ka option" },
  // hisaab + suraksha
  { group: "money", key: "cashHandover", label: "Agent cash hisaab", hi: "एजेंट नकद हिसाब", desc: "Agent ne kitna cash liya, kitna jama kiya", api: [/^\/programs\/[^/]+\/cash-handovers/] },
  { group: "money", key: "advancePayment", label: "Advance (अग्रिम) payment", hi: "अग्रिम भुगतान", desc: "Member ka advance jama karna, aur closing payment mein advance se kaatna (panel + agent app)", api: [/^\/members\/[^/]+\/advance/, /^\/advances\//, /^\/programs\/[^/]+\/advances/] },
  { group: "money", key: "fixedLimit", label: "Fixed rakam (seema)", hi: "निश्चित राशि", desc: "Sadasya ki kul closing rakam ki seema (jaise ₹15,200) — utna bharne ke baad aage koi baki nahi; advance bhi utna hi", api: [/^\/programs\/[^/]+\/fixed-limit$/] },
  { group: "money", key: "auditLog", label: "Activity log", hi: "गतिविधि लॉग", desc: "Kisne kya badla — Settings → Activity log", api: [/^\/audit$/] },
  // sampark + look
  { group: "connect", key: "whatsapp", label: "WhatsApp reminder", hi: "व्हाट्सऐप", desc: "Baki payment / rasid link WhatsApp pe (bina kharche)" },
  { group: "connect", key: "whatsappApi", label: "WhatsApp API (Gupshup)", hi: "व्हाट्सऐप API", desc: "Auto message — join par certificate, baki rasid, paid rasid + WhatsApp inbox (trust ka apna Gupshup)", api: [/^\/whatsapp\/(?!callback)/] },
  { group: "connect", key: "emailSend", label: "E-mail bhejna", hi: "ई-मेल", desc: "Panel se e-mail bhejna", api: [/^\/email-send$/] },
  { group: "connect", key: "theme", label: "Theme / colours", hi: "थीम", desc: "Settings → Theme se rang badalna", api: [/^\/trust\/theme$/], writeOnly: true },
  // mobile app (agent + member)
  { group: "app", key: "mobileApp", label: "Mobile app settings", hi: "मोबाइल ऐप", desc: "Settings → Mobile App: maintenance, update, app se bhugtan, sampark", api: [/^\/trust\/app-settings$/] },
  { group: "app", key: "paymentRequests", label: "App payment requests (UTR + screenshot)", hi: "भुगतान अनुरोध", desc: "Member / agent trust ke QR par bhugtan karke app se UTR + screenshot bhejein; office jaanch kar 'Accept' kare to payment jama — Payments → App requests",
    api: [/^\/payment-requests(\/|$)/, /^\/app\/payment-requests(\/|$)/] },
  { group: "app", key: "appNotifications", label: "App notification bhejna", hi: "ऐप सूचना", desc: "Settings → Notifications: member / agent phones par push (Expo, free) — auto: bhugtan, nayi closing",
    api: [/^\/notifications\/(send|audience|sent)$/] },
  { group: "app", key: "appLogins", label: "App logins (kaun, kitne phone)", hi: "ऐप लॉगिन", desc: "Settings → App logins: kitne member / agent ne app mein login kiya, kis phone par — aur phone se logout",
    api: [/^\/app-logins(\/|$)/] },
  { group: "app", key: "appPayment", label: "App se bhugtan (UPI / QR / bank)", hi: "ऐप से भुगतान", desc: "Member / agent app mein 'भुगतान करें' — band = app mein button nahi, Settings mein bhugtan wala hissa nahi", api: [/^\/app\/payment$/] },
];

const EXTRA_GROUPS = [
  { key: "rasid", label: "Rasid aur PDF", hi: "रसीद / PDF" },
  { key: "certificate", label: "Certificate", hi: "प्रमाण पत्र" },
  { key: "members", label: "Members aur form", hi: "सदस्य" },
  { key: "money", label: "Hisaab aur suraksha", hi: "हिसाब / सुरक्षा" },
  { key: "connect", label: "Sampark aur look", hi: "संपर्क" },
  { key: "app", label: "Mobile app (agent + member)", hi: "मोबाइल ऐप" },
];

/** Who may log in besides the trust admin. */
export const LOGIN_FEATURES = [
  { key: "agentLogin", label: "Agent login (mobile app)", hi: "एजेंट लॉगिन", desc: "Agents mobile app mein login kar sakein — band = app mein 'एजेंट' login dikhega hi nahi" },
  { key: "memberLogin", label: "Member login (mobile app)", hi: "सदस्य लॉगिन", desc: "Members reg. no. se app mein login kar sakein — band = app mein 'सदस्य' login dikhega hi nahi" },
];

export const FEATURE_GROUPS = [
  { key: "screens", label: "Screens (menu)", hi: "स्क्रीन", items: SCREEN_FEATURES },
  ...EXTRA_GROUPS.map((g) => ({ ...g, items: EXTRA_FEATURES.filter((f) => f.group === g.key) })),
  { key: "logins", label: "Logins", hi: "लॉगिन", items: LOGIN_FEATURES },
];
export const ALL_FEATURES = FEATURE_GROUPS.flatMap((g) => g.items);
export const FEATURE_KEYS = ALL_FEATURES.map((f) => f.key);

export const DEFAULT_BLOCK_MESSAGE = "Panel abhi band hai. Kripya trust ke administrator / support se sampark karein.";

/**
 * Clean what is stored / sent:
 * { flags: { members: true, theme: false, … }, active: true, message: "", updatedAt }
 * Unknown keys dropped; a missing flag means ON.
 */
export function normalizeFeatures(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const flagsIn = src.flags && typeof src.flags === "object" ? src.flags : {};
  const flags = {};
  for (const k of FEATURE_KEYS) flags[k] = flagsIn[k] !== false;
  const exp = /^\d{4}-\d{2}-\d{2}$/.test(String(src.expiresAt || "")) ? src.expiresAt : null;
  const warn = Number(src.warnDays);
  return {
    flags,
    active: src.active !== false,
    message: String(src.message || "").trim().slice(0, 300),
    expiresAt: exp,                                              // "YYYY-MM-DD" — last day the panel works
    warnDays: Number.isFinite(warn) && warn >= 0 && warn <= 60 ? Math.round(warn) : 7,
    support: normalizeSupport(src.support),                      // renew contact shown to the trust
    updatedAt: src.updatedAt || null,
  };
}

/** Renew / support contact (set on /feature-control): shown in the expiry warning and the "panel band" screen. */
export function normalizeSupport(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const t = (v, n) => String(v ?? "").trim().slice(0, n);
  const digits = (v) => t(v, 20).replace(/[^\d+]/g, "");
  return {
    name: t(s.name, 80),          // "Lalit Kumar" / company
    phone: digits(s.phone),       // call
    whatsapp: digits(s.whatsapp), // WhatsApp (empty = same as phone)
    email: t(s.email, 120),
    note: t(s.note, 300),         // "Renew: ₹5000 / saal · UPI xyz@upi"
  };
}
export const hasSupport = (s) => !!(s && (s.name || s.phone || s.whatsapp || s.email || s.note));

/** wa.me link: 10-digit Indian numbers get 91 in front. */
export function waLink(num, text = "") {
  let d = String(num || "").replace(/\D/g, "");
  if (d.length === 10) d = `91${d}`;
  return d ? `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}` : null;
}

const IST_MS = 5.5 * 3600 * 1000;
/** Today's date in India as "YYYY-MM-DD" (the server may run in UTC). */
export const todayIST = (now = Date.now()) => new Date(now + IST_MS).toISOString().slice(0, 10);

/**
 * Plan / subscription: { expiresAt, daysLeft, expired, warn }.
 * The panel works through the whole expiry day; from the next day it is closed.
 */
export function planState(features, now = Date.now()) {
  const f = features?.flags ? features : normalizeFeatures(features);
  if (!f.expiresAt) return { expiresAt: null, daysLeft: null, expired: false, warn: false };
  const daysLeft = Math.round((Date.parse(f.expiresAt) - Date.parse(todayIST(now))) / 86400000);
  return { expiresAt: f.expiresAt, daysLeft, expired: daysLeft < 0, warn: daysLeft >= 0 && daysLeft <= f.warnDays };
}

export const EXPIRED_MESSAGE = "Panel ka plan khatam ho gaya hai. Dobara chalu karwane ke liye support se sampark karein.";

export const isOn = (features, key) => (features ? features.flags?.[key] !== false : true);

/** Screen modules switched off → lib/permissions can() answers false for them, super admin too. */
export function disabledModules(features) {
  return SCREEN_FEATURES.filter((f) => !isOn(features, f.key)).map((f) => f.module);
}

/** Server: which extra feature (if any) guards this API request? → feature key or null */
export function featureForApi(method, pathname) {
  const p = pathname.replace(/^\/api/, "").replace(/\/+$/, "");
  const write = !["GET", "HEAD"].includes(String(method).toUpperCase());
  for (const f of EXTRA_FEATURES) {
    if (!f.api) continue;
    if (f.writeOnly && !write) continue;
    if (f.api.some((re) => re.test(p))) return f.key;
  }
  return null;
}

export function featureLabel(key) {
  return ALL_FEATURES.find((f) => f.key === key)?.label || key;
}

/** How many switches are off — for the control page list. */
export function offCount(features) {
  const f = normalizeFeatures(features);
  return FEATURE_KEYS.filter((k) => !f.flags[k]).length;
}

/** Browser / server: is `key` on for this caller? (access = auth.access / user.access) */
export const hasFeature = (access, key) => access?.features?.[key] !== false;

/** One-click starting points on the control page (flags not listed = on). */
export const FEATURE_PRESETS = [
  { key: "full", label: "Sab chalu", desc: "Poora panel", off: [] },
  { key: "standard", label: "Standard", desc: "Builder, theme, staff users, e-mail, cash hisaab, activity log band",
    off: ["certificateBuilder", "theme", "users", "emailSend", "cashHandover", "auditLog", "rasidDesign", "whatsappApi"] },
  { key: "basic", label: "Basic", desc: "Sirf members, yojna, payments, closing",
    off: ["reports", "commission", "users", "certificateBuilder", "theme", "receipts", "rasidDesign", "upiQr", "verifyQr", "paymentPdf", "exports",
      "emailSend", "countDisplay", "memberLogin", "cashHandover", "auditLog", "whatsapp", "duplicateCheck", "blankForm", "appPayment",
      "appNotifications", "appLogins", "whatsappApi", "advancePayment", "fixedLimit", "paymentRequests", "dataImport"] },
];

export function presetFlags(presetKey) {
  const p = FEATURE_PRESETS.find((x) => x.key === presetKey) || FEATURE_PRESETS[0];
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, !p.off.includes(k)]));
}
