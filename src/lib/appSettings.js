// Settings → Mobile App: what the agent / member app shows and allows.
// Stored on admins.extra.app (JSON). Plain module (no "@/" imports) so tests and services can use it.
//
//   maintenance  every phone shows "रखरखाव चल रहा है" until switched off
//   update       latest / minimum app version — below minimum the app is blocked until updated
//   payment      "भुगतान करें" screen for members / agents: UPI, bank account, QR, steps
//   support      phone / WhatsApp / e-mail / office hours shown in the app's settings
//   notify       automatic push notifications (Expo): payment received, new closing (member / agent)
//   aboutText    a short "about the trust" paragraph
//   memberCount  yojna ki kul sadasya sankhya app mein: agents / members ko dikhe ya nahi, aur kaun si ginti
//                (yojna jaisa = Yojna → "Member count kaise dikhe"; ya app ke liye alag: asli / % / fixed, har yojna ki)

const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bool = (v, d = false) => (typeof v === "boolean" ? v : d);
const VERSION = /^\d+(\.\d+){0,3}$/;
const ver = (v) => (VERSION.test(str(v, 20)) ? str(v, 20) : "");
export const isUpiId = (v) => /^[\w.\-]{2,}@[a-zA-Z][\w.\-]{1,}$/.test(String(v || ""));

export const APP_DEFAULTS = {
  maintenance: { on: false, message: "", until: "" },
  update: { latestVersion: "", minVersion: "", url: "", message: "" },
  payment: {
    members: false,
    agents: false,
    payeeName: "",
    upiId: "",
    bank: { accountName: "", accountNumber: "", ifsc: "", bankName: "", branch: "" },
    qrImage: "",
    confirmWhatsapp: "",
    steps: [],
    note: "",
  },
  support: { phone: "", whatsapp: "", email: "", officeHours: "", website: "" },
  notify: { payment: true, closing: true, agentClosing: true },
  aboutText: "",
  memberCount: { agents: false, members: false, source: "yojna", custom: {} },
};

const COUNT_SOURCES = ["yojna", "actual", "custom"];
/** custom: { [programId]: { mode: "percent", percent } | { mode: "fixed", fixed, baseActual, setAt } } (cleaned by memberCountDisplay) */
function normCustom(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [pid, c] of Object.entries(raw).slice(0, 50)) {
    if (!/^[\w-]{1,64}$/.test(pid) || !c || typeof c !== "object") continue;
    const mode = ["actual", "percent", "fixed"].includes(c.mode) ? c.mode : "actual";
    const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
    if (mode === "percent") out[pid] = { mode, percent: Math.min(Math.max(int(c.percent) || 100, 1), 1000) };
    else if (mode === "fixed") out[pid] = { mode, fixed: Math.max(int(c.fixed), 0), baseActual: Math.max(int(c.baseActual), 0), setAt: str(c.setAt, 40) };
    else out[pid] = { mode };
  }
  return out;
}

/** Whatever was saved → full, safe settings object. */
export function normalizeAppSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const m = r.maintenance || {};
  const u = r.update || {};
  const p = r.payment || {};
  const b = p.bank || {};
  const s = r.support || {};
  const nt = r.notify || {};
  const mc = r.memberCount || {};
  const upiId = str(p.upiId, 120);
  const steps = Array.isArray(p.steps) ? p.steps : typeof p.steps === "string" ? p.steps.split("\n") : [];
  return {
    maintenance: { on: bool(m.on), message: str(m.message, 400), until: str(m.until, 60) },
    update: { latestVersion: ver(u.latestVersion), minVersion: ver(u.minVersion), url: /^https?:\/\//.test(str(u.url, 400)) ? str(u.url, 400) : "", message: str(u.message, 400) },
    payment: {
      members: bool(p.members),
      agents: bool(p.agents),
      payeeName: str(p.payeeName, 80),
      upiId: isUpiId(upiId) ? upiId : "",
      bank: {
        accountName: str(b.accountName, 80),
        accountNumber: str(b.accountNumber, 30).replace(/\s+/g, ""),
        ifsc: str(b.ifsc, 15).toUpperCase(),
        bankName: str(b.bankName, 80),
        branch: str(b.branch, 80),
      },
      qrImage: str(p.qrImage, 500).startsWith("data:") ? "" : str(p.qrImage, 500),
      confirmWhatsapp: str(p.confirmWhatsapp, 20).replace(/[^\d+]/g, ""),
      steps: steps.map((x) => str(x, 200)).filter(Boolean).slice(0, 8),
      note: str(p.note, 400),
    },
    support: {
      phone: str(s.phone, 60),
      whatsapp: str(s.whatsapp, 20).replace(/[^\d+]/g, ""),
      email: str(s.email, 120),
      officeHours: str(s.officeHours, 120),
      website: str(s.website, 200),
    },
    notify: { payment: bool(nt.payment, true), closing: bool(nt.closing, true), agentClosing: bool(nt.agentClosing, true) },
    aboutText: str(r.aboutText, 1500),
    memberCount: {
      agents: bool(mc.agents),
      members: bool(mc.members),
      source: COUNT_SOURCES.includes(mc.source) ? mc.source : "yojna",
      custom: normCustom(mc.custom),
    },
  };
}

/** -1 if a < b, 0 if equal, 1 if a > b — "1.2" vs "1.10.0" done right. */
export function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The public part (before login): maintenance, update and which logins may pay. */
export function publicAppStatus(settings) {
  const s = normalizeAppSettings(settings);
  return {
    maintenance: s.maintenance,
    update: s.update,
    payment: { members: s.payment.members, agents: s.payment.agents },
  };
}
